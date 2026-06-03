/**
 * MCP tool definitions for the Alchemy Hyperliquid connector.
 *
 * Each tool's handler receives (args, auth):
 *   - args: zod-validated tool arguments
 *   - auth: per-request auth context. agentJwt populated in http transport
 *           mode when the Authorization header is present; empty otherwise.
 *
 * Write tools pick the right SDK instance:
 *   - If agentJwt is present → agent-mode SDK that POSTs /agent/exchange.
 *     The user signed approveAgent in advance; server signs each trade.
 *   - Else if ALCHEMY_HL_TRADE_KEY is set → hot-key SDK signs locally.
 *     This is the stdio / single-user path.
 *   - Else → tool returns a "no signer" stub message.
 *
 * Read-only tools (get_*) use a no-auth read SDK and ignore auth context.
 */

import { z } from "zod";
import { Alchemy, AlchemyHlError } from "@alchemy-hl/sdk";

import type { Config } from "./config.js";

/**
 * Per-request auth context. In stdio mode this is always empty (single-tenant,
 * uses the process-level hot key). In http mode the transport extracts a
 * Bearer token from the Authorization header and passes it in.
 */
export interface AuthContext {
  /** Privy JWT, set in http mode when Authorization: Bearer ... is present. */
  agentJwt?: string;
  /**
   * User's wallet address, extracted from the OAuth JWT's `sub` claim by the
   * http transport. Used by read tools (get_balance, get_open_orders,
   * get_approval) as the default `user` arg so callers don't have to repeat
   * their own address on every call.
   */
  userAddress?: `0x${string}`;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (args: unknown, auth: AuthContext) => Promise<string>;
}

export function buildTools(cfg: Config): Tool[] {
  // Hot-key SDK: one per process if a key is configured. Used in stdio mode
  // and as a fallback in http mode when a request arrives without auth.
  const hotSdk = cfg.ALCHEMY_HL_TRADE_KEY
    ? new Alchemy({
        baseUrl: cfg.ALCHEMY_HL_API_URL,
        privateKey: cfg.ALCHEMY_HL_TRADE_KEY as `0x${string}`,
      })
    : null;

  // Read-only SDK: no signer, no JWT — used by get_* tools so reads work in
  // any transport without auth.
  const readSdk = new Alchemy({ baseUrl: cfg.ALCHEMY_HL_API_URL });

  /** Pick the SDK for a write tool based on the request auth. */
  function sdkForWrite(auth: AuthContext): Alchemy | null {
    if (auth.agentJwt) {
      return new Alchemy({
        baseUrl: cfg.ALCHEMY_HL_API_URL,
        agentJwt: auth.agentJwt,
      });
    }
    return hotSdk;
  }

  const requireSigner = (toolName: string, auth: AuthContext): string | null => {
    if (auth.agentJwt || cfg.hasSigner) return null;
    return `Cannot execute ${toolName}: no auth available. In http transport mode, the calling host (Claude/ChatGPT) must pass Authorization: Bearer <privy-jwt>. In stdio mode, set ALCHEMY_HL_TRADE_KEY on the server. Read-only tools still work.`;
  };

  return [
    // ========================================================================
    // Read-only tools
    // ========================================================================

    {
      name: "get_markets",
      description:
        "List all tradable markets on Hyperliquid. Returns perpetual futures (perps) and spot pairs with their asset indices, size-decimal precision, and (for perps) max leverage. Use this to discover available symbols before placing trades, or to look up an asset's index when the user asks about a specific coin.",
      inputSchema: z.object({
        type: z
          .enum(["perp", "spot", "all"])
          .default("all")
          .describe("Filter to perps only, spot only, or both. Default: all."),
        limit: z
          .number()
          .int()
          .positive()
          .max(500)
          .optional()
          .describe("Cap how many markets to return per category (perps + spot)."),
      }),
      async handler(rawArgs) {
        const args = z
          .object({ type: z.enum(["perp", "spot", "all"]).default("all"), limit: z.number().int().positive().max(500).optional() })
          .parse(rawArgs ?? {});
        const m = await readSdk.markets();
        const out: Record<string, unknown> = {};
        if (args.type === "perp" || args.type === "all") {
          out.perps = (args.limit ? m.perps.slice(0, args.limit) : m.perps).map((p) => ({
            symbol: p.name,
            assetIndex: p.assetIndex,
            maxLeverage: p.maxLeverage,
            szDecimals: p.szDecimals,
          }));
        }
        if (args.type === "spot" || args.type === "all") {
          out.spot = (args.limit ? m.spot.slice(0, args.limit) : m.spot).map((s) => ({
            symbol: s.name,
            base: s.base,
            quote: s.quote,
            assetIndex: s.assetIndex,
            szDecimals: s.szDecimals,
          }));
        }
        return JSON.stringify(out, null, 2);
      },
    },

    {
      name: "get_market_price",
      description:
        "Get the current mid market price for an asset by symbol (e.g. 'BTC', 'ETH'). Returns the latest mid in USD. Use before computing position sizing from a notional.",
      inputSchema: z.object({
        symbol: z.string().describe("Asset symbol like 'BTC' or 'ETH'."),
      }),
      async handler(rawArgs) {
        const { symbol } = z.object({ symbol: z.string() }).parse(rawArgs);
        const asset = await readSdk.resolveAsset(symbol);
        const mp = await readSdk.markPrice(asset.assetIndex);
        return JSON.stringify({ symbol: mp.coin, mid: mp.mid }, null, 2);
      },
    },

    {
      name: "get_balance",
      description:
        "Read a wallet's Hyperliquid perp account balance. Returns total account value in USD, withdrawable amount, margin in use, and count of open positions. If `user` is omitted, defaults to the wallet configured as the server's trading key.",
      inputSchema: z.object({
        user: z
          .string()
          .regex(/^0x[0-9a-fA-F]{40}$/)
          .optional()
          .describe("0x-prefixed wallet address. Optional."),
      }),
      async handler(rawArgs, auth) {
        const { user } = z
          .object({ user: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional() })
          .parse(rawArgs ?? {});
        const effectiveUser = (user as `0x${string}` | undefined) ?? auth.userAddress;
        if (effectiveUser) {
          const bal = await readSdk.balance(effectiveUser);
          return JSON.stringify(bal, null, 2);
        }
        // No explicit user, no OAuth-derived user → fall back to hot signer.
        if (hotSdk) {
          const bal = await hotSdk.balance();
          return JSON.stringify(bal, null, 2);
        }
        return JSON.stringify(
          { error: "Pass `user` explicitly — no auth context to default from." },
          null,
          2,
        );
      },
    },

    {
      name: "get_open_orders",
      description:
        "List a wallet's resting (open, unfilled) orders on Hyperliquid. Each order in the response includes a pre-built cancel action that can be passed to cancel_order. If `user` is omitted, defaults to the authenticated wallet (from the OAuth session) or the server's trading key.",
      inputSchema: z.object({
        user: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
      }),
      async handler(rawArgs, auth) {
        const { user } = z
          .object({ user: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional() })
          .parse(rawArgs ?? {});
        const effectiveUser = (user as `0x${string}` | undefined) ?? auth.userAddress;
        if (effectiveUser) {
          const orders = await readSdk.openOrders(effectiveUser);
          return JSON.stringify(orders, null, 2);
        }
        if (hotSdk) {
          const orders = await hotSdk.openOrders();
          return JSON.stringify(orders, null, 2);
        }
        return JSON.stringify(
          { error: "Pass `user` explicitly — no auth context to default from." },
          null,
          2,
        );
      },
    },

    {
      name: "get_approval",
      description:
        "Check whether a wallet has approved Alchemy as a Hyperliquid builder, and at what max fee rate. Returns { approved, maxFeeRate, canTradePerps, canTradeSpot }. Use this before placing trades — if approved=false, the user needs to call approve_builder first. Defaults to the authenticated wallet.",
      inputSchema: z.object({
        user: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
      }),
      async handler(rawArgs, auth) {
        const { user } = z
          .object({ user: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional() })
          .parse(rawArgs ?? {});
        const effectiveUser = (user as `0x${string}` | undefined) ?? auth.userAddress;
        if (effectiveUser) {
          const approval = await readSdk.approval(effectiveUser);
          return JSON.stringify(approval, null, 2);
        }
        if (hotSdk) {
          const approval = await hotSdk.approval();
          return JSON.stringify(approval, null, 2);
        }
        return JSON.stringify(
          { error: "Pass `user` explicitly — no auth context to default from." },
          null,
          2,
        );
      },
    },

    // ========================================================================
    // Write tools — require ALCHEMY_HL_TRADE_KEY
    // ========================================================================

    {
      name: "place_market_order",
      description:
        "Place a marketable IOC (immediate-or-cancel) order on Hyperliquid. Pass either `notional` (USD) OR `size` (in base asset units), not both. The order takes whatever's on the book up to a price 5% beyond the current mark — typically fills at the best ask (for buys) or best bid (for sells). Returns the fill details: filledSize, avgPrice, oid.",
      inputSchema: z.object({
        symbol: z.string().describe("Asset symbol like 'BTC' or 'ETH'."),
        side: z.enum(["buy", "sell"]),
        notional: z.number().positive().optional().describe("USD notional to fill. Mutually exclusive with `size`."),
        size: z.number().positive().optional().describe("Order size in base units. Mutually exclusive with `notional`."),
        reduceOnly: z
          .boolean()
          .optional()
          .describe("If true, this order can only reduce an existing position. Use for closing trades."),
      }),
      async handler(rawArgs, auth) {
        const lock = requireSigner("place_market_order", auth);
        if (lock) return lock;
        const args = z
          .object({
            symbol: z.string(),
            side: z.enum(["buy", "sell"]),
            notional: z.number().positive().optional(),
            size: z.number().positive().optional(),
            reduceOnly: z.boolean().optional(),
          })
          .parse(rawArgs);
        const sdk = sdkForWrite(auth)!;
        try {
          const fn = args.side === "buy" ? sdk.marketBuy.bind(sdk) : sdk.marketSell.bind(sdk);
          const result = await fn(args.symbol, {
            notional: args.notional,
            size: args.size,
            reduceOnly: args.reduceOnly,
          });
          if (result.error) {
            return JSON.stringify({ ok: false, error: result.error, raw: result.raw }, null, 2);
          }
          return JSON.stringify(
            {
              ok: true,
              filled: result.filled,
              filledSize: result.filledSize,
              avgPrice: result.avgPrice,
              oid: result.oid,
              user: result.user,
            },
            null,
            2,
          );
        } catch (err) {
          return errToMessage(err);
        }
      },
    },

    {
      name: "place_limit_order",
      description:
        "Place a limit order on Hyperliquid. The order rests on the book at the specified price until filled, cancelled, or expired. `tif` (time-in-force) defaults to 'Gtc' (good-til-cancelled); 'Ioc' for immediate-or-cancel (fills what it can right now, cancels rest); 'Alo' for add-liquidity-only (post-only, never takes liquidity).",
      inputSchema: z.object({
        symbol: z.string(),
        side: z.enum(["buy", "sell"]),
        size: z.number().positive(),
        price: z.number().positive(),
        tif: z.enum(["Gtc", "Ioc", "Alo"]).default("Gtc"),
        reduceOnly: z.boolean().optional(),
      }),
      async handler(rawArgs, auth) {
        const lock = requireSigner("place_limit_order", auth);
        if (lock) return lock;
        const args = z
          .object({
            symbol: z.string(),
            side: z.enum(["buy", "sell"]),
            size: z.number().positive(),
            price: z.number().positive(),
            tif: z.enum(["Gtc", "Ioc", "Alo"]).default("Gtc"),
            reduceOnly: z.boolean().optional(),
          })
          .parse(rawArgs);
        const sdk = sdkForWrite(auth)!;
        try {
          const result = await sdk.limitOrder({
            symbol: args.symbol,
            side: args.side,
            size: args.size,
            price: args.price,
            tif: args.tif,
            reduceOnly: args.reduceOnly,
          });
          return JSON.stringify(
            {
              ok: !result.error,
              filled: result.filled,
              filledSize: result.filledSize,
              avgPrice: result.avgPrice,
              oid: result.oid,
              restingOid: result.restingOid,
              error: result.error,
            },
            null,
            2,
          );
        } catch (err) {
          return errToMessage(err);
        }
      },
    },

    {
      name: "cancel_order",
      description:
        "Cancel an existing open order by its order id (oid) and symbol. Idempotent — cancelling an already-filled or cancelled order returns a status, not an error.",
      inputSchema: z.object({
        symbol: z.string(),
        oid: z.number().int().positive(),
      }),
      async handler(rawArgs, auth) {
        const lock = requireSigner("cancel_order", auth);
        if (lock) return lock;
        const args = z
          .object({ symbol: z.string(), oid: z.number().int().positive() })
          .parse(rawArgs);
        const sdk = sdkForWrite(auth)!;
        try {
          const result = await sdk.cancel({ symbol: args.symbol, oid: args.oid });
          // cancel returns SendResponse (no per-order fill data to parse).
          return JSON.stringify(
            { ok: result.success, user: result.user, exchangeResponse: result.exchangeResponse },
            null,
            2,
          );
        } catch (err) {
          return errToMessage(err);
        }
      },
    },

    {
      name: "set_leverage",
      description:
        "Set the leverage multiplier for an asset on the trading wallet's Hyperliquid account. Higher leverage means less margin required per dollar of notional but proportionally larger PnL swings. Persists across trades until changed. Default mode is 'cross' (recommended); 'isolated' margins the position separately. The server enforces a hard cap on the agent-authed path — exceeding it returns INVALID_PARAMS with the cap value. When suggesting leverage to the user, mention the risk: 10x leverage means a 10% price move against the position liquidates it.",
      inputSchema: z.object({
        symbol: z.string().describe("Asset symbol like 'BTC' or 'ETH'."),
        leverage: z
          .number()
          .int()
          .min(1)
          .max(50)
          .describe("Integer leverage multiplier (1 to 50)."),
        mode: z
          .enum(["cross", "isolated"])
          .default("cross")
          .describe("Margin mode. 'cross' shares margin across positions; 'isolated' margins per-position."),
      }),
      async handler(rawArgs, auth) {
        const lock = requireSigner("set_leverage", auth);
        if (lock) return lock;
        const args = z
          .object({
            symbol: z.string(),
            leverage: z.number().int().min(1).max(50),
            mode: z.enum(["cross", "isolated"]).default("cross"),
          })
          .parse(rawArgs);
        const sdk = sdkForWrite(auth)!;
        try {
          const result = await sdk.setLeverage(args.symbol, args.leverage, args.mode);
          return JSON.stringify(
            {
              ok: result.success,
              symbol: args.symbol,
              leverage: args.leverage,
              mode: args.mode,
              user: result.user,
            },
            null,
            2,
          );
        } catch (err) {
          return errToMessage(err);
        }
      },
    },

    {
      name: "approve_builder",
      description:
        "Sign the one-time `approveBuilderFee` action authorizing Alchemy as a builder for the trading wallet. After this lands, all subsequent orders this wallet places auto-include the builder fee within the approved ceiling. `maxFeeRate` is a percent string like '1%' or '0.04%'. Call once during setup, before placing trades. Pass `maxFeeRate: '0%'` to revoke.",
      inputSchema: z.object({
        maxFeeRate: z
          .string()
          .regex(/^\d+(\.\d+)?%$/)
          .describe("Percent string like '1%' or '0.04%'. Pass '0%' to revoke."),
      }),
      async handler(rawArgs, auth) {
        const lock = requireSigner("approve_builder", auth);
        if (lock) return lock;
        // approveBuilderFee MUST come from the user's primary signature —
        // refuse the agent-mode path explicitly with a clear message.
        if (auth.agentJwt) {
          return JSON.stringify(
            {
              ok: false,
              error: "approve_builder requires the user's primary wallet signature. From an agent-authed connector this isn't possible — direct the user to the web /approve page to sign approveBuilderFee there.",
            },
            null,
            2,
          );
        }
        const { maxFeeRate } = z
          .object({ maxFeeRate: z.string().regex(/^\d+(\.\d+)?%$/) })
          .parse(rawArgs);
        const sdk = hotSdk!;
        try {
          const result = await sdk.approveBuilder({ maxFeeRate });
          // approveBuilder returns SendResponse (no fill data).
          return JSON.stringify(
            { ok: result.success, user: result.user, exchangeResponse: result.exchangeResponse },
            null,
            2,
          );
        } catch (err) {
          return errToMessage(err);
        }
      },
    },
  ];
}

function errToMessage(err: unknown): string {
  if (err instanceof AlchemyHlError) {
    return JSON.stringify(
      {
        ok: false,
        error: err.code,
        message: err.message,
        guidance: err.guidance,
      },
      null,
      2,
    );
  }
  return JSON.stringify(
    {
      ok: false,
      error: "SDK_ERROR",
      message: (err as Error)?.message ?? String(err),
    },
    null,
    2,
  );
}
