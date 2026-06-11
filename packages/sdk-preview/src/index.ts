/**
 * @alchemy-hl/sdk-preview
 *
 * A thin typed fetch wrapper around the Alchemy Hyperliquid API. Preview-only:
 * no signing, no transport beyond fetch. Real SDKs (with local key management
 * and signing) ship later. The point of this package is so the homepage code
 * snippets compile against something real.
 */

import type {
  Action,
  AgentState,
  ApiError,
  ApprovalState,
  BalanceState,
  BuildRequest,
  BuildResponse,
  DexesResponse,
  MarketsResponse,
  OpenOrdersResponse,
  PositionsResponse,
  SendRequest,
  SendResponse,
  Signature,
  UserFillsResponse,
} from "@alchemy-hl/shared";

export type {
  Action,
  AgentState,
  ApiError,
  ApprovalState,
  BalanceState,
  BuildResponse,
  DexesResponse,
  MarketsResponse,
  OpenOrdersResponse,
  PositionsResponse,
  SendResponse,
  Signature,
  UserFillsResponse,
};
export type { OpenOrder, PerpPosition } from "@alchemy-hl/shared";
export type { UserFill } from "@alchemy-hl/shared";

export interface ClientOptions {
  /** Base URL of the Alchemy Hyperliquid API. */
  baseUrl: string;
  /** Optional fetch implementation override (useful in tests). */
  fetch?: typeof fetch;
}

export class AlchemyHyperliquid {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** Build an action (server injects builder + returns the hash to sign). */
  build(action: Action): Promise<BuildResponse> {
    return this.request<BuildResponse>("POST", "/exchange", {
      action,
    } satisfies BuildRequest);
  }

  /** Send a signed action (server verifies + forwards to Hyperliquid). */
  send(action: Action, nonce: number, signature: Signature): Promise<SendResponse> {
    return this.request<SendResponse>("POST", "/exchange", {
      action,
      nonce,
      signature,
    } satisfies SendRequest);
  }

  /** Check whether `user` has approved Alchemy's builder fee. */
  approval(user: `0x${string}`): Promise<ApprovalState> {
    return this.request<ApprovalState>(
      "GET",
      `/approval?user=${encodeURIComponent(user)}`,
    );
  }

  /** Read `user`'s HL perp account balance (accountValue + withdrawable + marginUsed). */
  balance(user: `0x${string}`): Promise<BalanceState> {
    return this.request<BalanceState>(
      "GET",
      `/balance?user=${encodeURIComponent(user)}`,
    );
  }

  markets(): Promise<MarketsResponse> {
    return this.request<MarketsResponse>("GET", "/markets");
  }

  dexes(): Promise<DexesResponse> {
    return this.request<DexesResponse>("GET", "/dexes");
  }

  /** Open perp positions with per-position PnL. */
  positions(user: `0x${string}`): Promise<PositionsResponse> {
    return this.request<PositionsResponse>(
      "GET",
      `/positions?user=${encodeURIComponent(user)}`,
    );
  }

  /** Resting orders, each with a ready-to-sign cancelAction. */
  openOrders(user: `0x${string}`): Promise<OpenOrdersResponse> {
    return this.request<OpenOrdersResponse>("POST", "/openOrders", { user });
  }

  /** Recent fills, newest first. */
  userFills(user: `0x${string}`, limit = 20): Promise<UserFillsResponse> {
    return this.request<UserFillsResponse>(
      "GET",
      `/userFills?user=${encodeURIComponent(user)}&limit=${limit}`,
    );
  }

  /** The user's derived agent wallet + whether it's approved on HL. */
  agent(user: `0x${string}`): Promise<AgentState> {
    return this.request<AgentState>("GET", `/agent?user=${encodeURIComponent(user)}`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      throw Object.assign(new Error((json as ApiError)?.message ?? res.statusText), {
        status: res.status,
        body: json,
      });
    }
    return json as T;
  }
}
