/**
 * Alchemy Hyperliquid SDK client.
 *
 * Owns local signing — calls our backend's /exchange (build phase) to get the
 * typed-data envelope, signs it with the configured signer, calls /exchange
 * (send phase) with the signature. All the HL serialization quirks (v
 * normalization, lowercase builder address, tenths-of-bps for builder.f) are
 * handled by the backend — the SDK just signs whatever typed-data the backend
 * returns.
 *
 * @example
 *   const sdk = new Alchemy({
 *     privateKey: process.env.PK as `0x${string}`,
 *     baseUrl: "https://api.alchemy.com/hyperliquid", // optional
 *   });
 *   await sdk.marketBuy("BTC", { notional: 100 });
 */

import type {
  ApprovalState,
  BalanceState,
  BuildResponse,
  DexesResponse,
  MarketsResponse,
  SendResponse,
} from "@alchemy-hl/shared";

/**
 * Ergonomic fill result returned by trading methods (limitOrder, marketBuy,
 * marketSell). Mirrors HL's per-leg status object but flattened into
 * easily-printable fields.
 *
 * - `filledSize` / `avgPrice` / `oid` are present when the order filled
 *   (fully or partially).
 * - `restingOid` is present when a limit order didn't fully fill and the
 *   remainder is resting on the book.
 * - `error` is HL's literal rejection string when the order was rejected at
 *   the matcher level (HL returns status: "ok" outer with a per-leg error
 *   inside; we surface that here so callers can switch on it without
 *   parsing the raw envelope).
 * - `raw` is the full {@link SendResponse} from the backend — escape hatch.
 */
export interface OrderResult {
  filledSize?: string;
  avgPrice?: string;
  oid?: number;
  restingOid?: number;
  error?: string;
  /** True if the leg filled (totally or partially). */
  filled: boolean;
  /** The wallet address HL recognized as the order's signer. */
  user: `0x${string}`;
  raw: SendResponse;
}

import {
  buildApproveBuilderFee,
  buildCancel,
  buildLimitOrder,
  buildMarketOrder,
  buildUpdateLeverage,
  type LimitOrderParams,
  type MarketOrderParams,
} from "./actions.js";
import { AssetCache, type AssetInfo } from "./assets.js";
import { AlchemyHlError, SdkInputError, type ApiError } from "./errors.js";
import {
  makeSigner,
  normalizeHexSig,
  type Signer,
  type SignerConfig,
} from "./signer.js";

export type ClientOptions = {
  /** Base URL of the Alchemy Hyperliquid REST API. */
  baseUrl?: string;
  /**
   * Override the fetch implementation (useful in tests). Defaults to
   * `globalThis.fetch`.
   */
  fetch?: typeof fetch;
  /**
   * Privy JWT for agent-mode signing. When set, trading methods route
   * through POST /agent/exchange instead of POST /exchange — the backend
   * signs with the user's per-user agent key (no local signer needed,
   * no per-trade browser popup). Mutually exclusive with `privateKey` /
   * external signer config: pass exactly one auth model.
   *
   * The user must have previously signed approveAgent through the normal
   * /exchange flow for the agent to be authorized.
   */
  agentJwt?: string;
} & Partial<SignerConfig>;

const DEFAULT_BASE_URL = "http://localhost:8080";

export class Alchemy {
  readonly baseUrl: string;
  private readonly signer: Signer | null;
  private readonly agentJwt: string | null;
  private readonly fetchOverride?: typeof fetch;
  private readonly assets: AssetCache;

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchOverride = opts.fetch;
    if (!this.fetchOverride && typeof globalThis.fetch !== "function") {
      throw new SdkInputError(
        "No fetch implementation found. Pass `fetch` in client options.",
      );
    }
    if (isSignerConfig(opts) && opts.agentJwt) {
      throw new SdkInputError(
        "Pass either a signer (privateKey / external) OR agentJwt — not both. Agent mode delegates signing to the backend; user-signed mode signs locally.",
      );
    }
    this.signer = isSignerConfig(opts) ? makeSigner(opts) : null;
    this.agentJwt = opts.agentJwt ?? null;
    this.assets = new AssetCache(() => this.markets());
  }

  /**
   * Resolve fetch at call-time. Binding at construction breaks test mocks
   * (vi.spyOn replaces globalThis.fetch but bound references keep the
   * original). This getter looks up the active implementation each call.
   */
  private get fetchImpl(): typeof fetch {
    return this.fetchOverride ?? globalThis.fetch;
  }

  // ==========================================================================
  // Read endpoints — no signing
  // ==========================================================================

  markets(): Promise<MarketsResponse> {
    return this.get<MarketsResponse>("/markets");
  }

  dexes(): Promise<DexesResponse> {
    return this.get<DexesResponse>("/dexes");
  }

  /**
   * Read a wallet's HL perp balance. Defaults to the signer's address; pass
   * an explicit `user` to read someone else's.
   */
  balance(user?: `0x${string}`): Promise<BalanceState> {
    const addr = user ?? this.requireSignerAddress();
    return this.get<BalanceState>(`/balance?user=${encodeURIComponent(addr)}`);
  }

  approval(user?: `0x${string}`): Promise<ApprovalState> {
    const addr = user ?? this.requireSignerAddress();
    return this.get<ApprovalState>(
      `/approval?user=${encodeURIComponent(addr)}`,
    );
  }

  openOrders(user?: `0x${string}`): Promise<unknown> {
    const addr = user ?? this.requireSignerAddress();
    return this.post<unknown>("/openOrders", { user: addr });
  }

  orderStatus(oid: number, user?: `0x${string}`): Promise<unknown> {
    const addr = user ?? this.requireSignerAddress();
    return this.post<unknown>("/orderStatus", { user: addr, oid });
  }

  /** Current mark price for an asset by index, e.g. `markPrice(0)` for BTC. */
  markPrice(assetIndex: number): Promise<{ asset: number; coin: string; mid: string }> {
    return this.get(`/markPrice?asset=${assetIndex}`);
  }

  /** Resolve a symbol like "BTC" to its asset index + size precision info. */
  resolveAsset(symbol: string): Promise<AssetInfo> {
    return this.assets.resolve(symbol);
  }

  // ==========================================================================
  // Trading primitives — sign + send
  // ==========================================================================

  /**
   * Place a limit order. `symbol` resolves via /markets to an asset index.
   *
   * @example
   *   sdk.limitOrder({ symbol: "BTC", side: "buy", size: 0.001, price: 60000, tif: "Gtc" })
   */
  async limitOrder(
    p: Omit<LimitOrderParams, "assetIndex"> & { symbol: string },
  ): Promise<OrderResult> {
    const asset = await this.assets.resolve(p.symbol);
    const action = buildLimitOrder({
      ...p,
      assetIndex: asset.assetIndex,
      szDecimals: asset.szDecimals,
      isSpot: asset.isSpot,
    });
    const sent = await this.signAndSend(action);
    return parseOrderResult(sent);
  }

  /**
   * Place a marketable IOC order using mark price + slippage. Pass either
   * `size` (base units) or `notional` (USD). The actual fill price will be
   * whatever's on the book at fill time.
   *
   * @example
   *   sdk.marketBuy("BTC", { notional: 100 })   // $100 of BTC
   *   sdk.marketSell("ETH", { size: 0.05 })     // 0.05 ETH
   */
  async marketBuy(
    symbol: string,
    opts: Omit<MarketOrderParams, "assetIndex" | "side" | "markPrice"> & {
      markPrice?: MarketOrderParams["markPrice"];
    } = {},
  ): Promise<OrderResult> {
    return this.marketOrder({ ...opts, symbol, side: "buy" });
  }

  async marketSell(
    symbol: string,
    opts: Omit<MarketOrderParams, "assetIndex" | "side" | "markPrice"> & {
      markPrice?: MarketOrderParams["markPrice"];
    } = {},
  ): Promise<OrderResult> {
    return this.marketOrder({ ...opts, symbol, side: "sell" });
  }

  /** Cancel one or more open orders by oid. */
  async cancel(
    items: { symbol: string; oid: number }[] | { symbol: string; oid: number },
  ): Promise<SendResponse> {
    const arr = Array.isArray(items) ? items : [items];
    const resolved = await Promise.all(
      arr.map(async (i) => ({
        assetIndex: (await this.assets.resolve(i.symbol)).assetIndex,
        oid: i.oid,
      })),
    );
    const action = buildCancel(resolved);
    return this.signAndSend(action);
  }

  /**
   * Sign the one-time approveBuilderFee authorization. After this lands, all
   * subsequent orders this wallet places through Alchemy get the builder fee
   * injected (within the approved ceiling).
   *
   * Always requires a user-key signer (hot key or external) — refuses
   * agent-mode since approveBuilderFee must come from the user's primary
   * wallet to be a valid authorization.
   */
  async approveBuilder(opts: { maxFeeRate: string }): Promise<SendResponse> {
    if (this.agentJwt) {
      throw new SdkInputError(
        "approveBuilder requires a user-key signer. Agent mode delegates trading but the user must sign approveBuilderFee themselves.",
      );
    }
    const action = buildApproveBuilderFee(opts.maxFeeRate);
    return this.signAndSend(action);
  }

  /** Revoke by re-approving with "0%". */
  async revokeBuilder(): Promise<SendResponse> {
    return this.approveBuilder({ maxFeeRate: "0%" });
  }

  /**
   * Set the leverage multiplier for an asset on the user's HL account.
   * Persists across trades until changed. Higher leverage = less margin per
   * dollar of notional.
   *
   * Agent mode is allowed but the backend enforces MAX_AGENT_LEVERAGE_PERPS.
   * For higher leverage, use a user-key signer.
   *
   * @example
   *   sdk.setLeverage("BTC", 5)             // 5x cross-margin on BTC
   *   sdk.setLeverage("ETH", 3, "isolated") // 3x isolated margin on ETH
   */
  async setLeverage(
    symbol: string,
    leverage: number,
    mode: "cross" | "isolated" = "cross",
  ): Promise<SendResponse> {
    const asset = await this.assets.resolve(symbol);
    const action = buildUpdateLeverage({
      assetIndex: asset.assetIndex,
      leverage,
      isCross: mode === "cross",
    });
    return this.signAndSend(action);
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private async marketOrder(
    p: Omit<MarketOrderParams, "assetIndex" | "markPrice"> & {
      symbol: string;
      markPrice?: MarketOrderParams["markPrice"];
    },
  ): Promise<OrderResult> {
    const asset = await this.assets.resolve(p.symbol);
    // If notional was given but no markPrice override, fetch live mid.
    let markPrice: MarketOrderParams["markPrice"] = p.markPrice;
    if (p.notional !== undefined && markPrice === undefined) {
      const mp = await this.markPrice(asset.assetIndex);
      markPrice = mp.mid;
    }
    const action = buildMarketOrder({
      ...p,
      assetIndex: asset.assetIndex,
      szDecimals: asset.szDecimals,
      isSpot: asset.isSpot,
      markPrice,
    });
    const sent = await this.signAndSend(action);
    return parseOrderResult(sent);
  }

  private async signAndSend(action: unknown): Promise<SendResponse> {
    // Agent mode: backend signs server-side via the user's derived agent key.
    // No build/sign dance — single POST to /agent/exchange with the JWT.
    if (this.agentJwt) {
      return this.agentSend(action);
    }

    const signer = this.requireSigner();

    // Phase A: build — let the backend inject builder + return typed-data.
    const built = await this.post<BuildResponse>("/exchange", { action });
    if (!built.typedData) {
      throw new AlchemyHlError({
        code: "INTERNAL_ERROR",
        message: "Server did not return typedData for build phase.",
        guidance:
          "This is an SDK/backend mismatch. Check that the backend version supports the action type you submitted.",
        httpStatus: 500,
      });
    }

    // Phase B: sign locally with the configured signer.
    const sigHex = await signer.signTypedData({
      domain: built.typedData.domain,
      types: built.typedData.types,
      primaryType: built.typedData.primaryType,
      message: built.typedData.message as Record<string, unknown>,
    });
    const signature = normalizeHexSig(sigHex);

    // Phase B continued: send to backend, which forwards to HL.
    return this.post<SendResponse>("/exchange", {
      action: built.action,
      nonce: built.nonce,
      signature,
    });
  }

  /**
   * Single-call submission via the agent-signing path. Backend authenticates
   * the JWT, derives the user's agent key from AGENT_MASTER_SEED, signs the
   * action, forwards to HL. Used by the MCP server when serving Claude/ChatGPT.
   */
  private async agentSend(action: unknown): Promise<SendResponse> {
    return this.request<SendResponse>("POST", "/agent/exchange", { action });
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method };
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    // Attach Bearer token when in agent mode — backend uses it for the
    // /agent/exchange path's Privy JWT verification. Harmless on read-only
    // calls that ignore the header.
    if (this.agentJwt) {
      headers.authorization = `Bearer ${this.agentJwt}`;
    }
    if (Object.keys(headers).length > 0) init.headers = headers;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }
    if (!res.ok) {
      const err = (parsed ?? {}) as Partial<ApiError>;
      throw new AlchemyHlError({
        code: (err.error as ApiError["error"]) ?? "INTERNAL_ERROR",
        message: err.message ?? res.statusText,
        guidance: err.guidance ?? "No guidance returned by the API.",
        httpStatus: res.status,
        response: parsed,
      });
    }
    return parsed as T;
  }

  private requireSigner(): Signer {
    if (!this.signer) {
      throw new SdkInputError(
        "This call requires a signer. Pass `privateKey` or `{ account, signTypedDataAsync }` to the Alchemy constructor.",
      );
    }
    return this.signer;
  }

  private requireSignerAddress(): `0x${string}` {
    return this.requireSigner().address;
  }
}

function isSignerConfig(opts: ClientOptions): opts is ClientOptions & SignerConfig {
  return "privateKey" in opts || ("account" in opts && "signTypedDataAsync" in opts);
}

/**
 * Parse HL's per-leg status from a SendResponse into ergonomic OrderResult.
 *
 * HL's response shape (verified live during the smoke test):
 *   { status: "ok", response: { type: "order",
 *       data: { statuses: [
 *         { filled: { totalSz, avgPx, oid } }   // fully or partially filled
 *         | { resting: { oid } }                // limit order on the book
 *         | { error: "..." }                    // matcher-level rejection
 *       ]}}}
 *
 * Currently surfaces only the first leg's status — multi-leg orders aren't
 * exposed yet in the SDK. Raw response is always preserved on `.raw`.
 */
function parseOrderResult(sent: SendResponse): OrderResult {
  const out: OrderResult = {
    filled: false,
    user: sent.user,
    raw: sent,
  };

  const er = sent.exchangeResponse as
    | { response?: { data?: { statuses?: unknown[] } } }
    | undefined;
  const first = er?.response?.data?.statuses?.[0] as
    | {
        filled?: { totalSz?: string; avgPx?: string; oid?: number };
        resting?: { oid?: number };
        error?: string;
      }
    | undefined;
  if (!first) return out;

  if (first.filled) {
    out.filled = true;
    out.filledSize = first.filled.totalSz;
    out.avgPrice = first.filled.avgPx;
    out.oid = first.filled.oid;
  } else if (first.resting) {
    out.restingOid = first.resting.oid;
  } else if (first.error) {
    out.error = first.error;
  }
  return out;
}
