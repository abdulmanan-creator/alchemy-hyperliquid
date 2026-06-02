/**
 * MCP tool definitions for the Alchemy Hyperliquid connector.
 *
 * Each tool has:
 *   - name: function-style (`place_market_order`); Claude infers when to call from name + description
 *   - description: one-paragraph natural language, written for Claude not humans
 *   - inputSchema: zod, exported as JSON Schema for MCP transport
 *   - handler: async (args) => result string. Result is what Claude sees in chat.
 *
 * Read-only tools work without a signer. Write tools (place_*, cancel_*,
 * approve_builder) return a "no signer configured" stub message if
 * ALCHEMY_HL_TRADE_KEY isn't set — useful for offering Claude a research-only
 * agent without trading authority.
 *
 * The hot-key signing model is a Phase-1 simplification. Phase-2 (API
 * wallets) replaces it with per-user agent wallets keyed off a Privy session.
 */

import { z } from "zod";
import { Alchemy, AlchemyHlError } from "@alchemy-hl/sdk";

import type { Config } from "./config.js";

export interface Tool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (args: unknown) => Promise<string>;
}

export function buildTools(cfg: Config): Tool[] {
  // One SDK instance per server boot. Caches the asset map, reuses fetch.
  const sdk = new Alchemy({
    baseUrl: cfg.ALCHEMY_HL_API_URL,
    ...(cfg.ALCHEMY_HL_TRADE_KEY
      ? { privateKey: cfg.ALCHEMY_HL_TRADE_KEY as `0x${string}` }
      : {}),
  });

  const requireSigner = (toolName: string): string | null => {
    if (cfg.hasSigner) return null;
    return `Cannot execute ${toolName}: no trading key configured on the MCP server. Set ALCHEMY_HL_TRADE_KEY in the server's environment to enable write operations. Read-only tools still work.`;
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
        const m = await sdk.markets();
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
        const asset = await sdk.resolveAsset(symbol);
        const mp = await sdk.markPrice(asset.assetIndex);
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
      async handler(rawArgs) {
        const { user } = z
          .object({ user: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional() })
          .parse(rawArgs ?? {});
        const bal = await sdk.balance(user as `0x${string}` | undefined);
        return JSON.stringify(bal, null, 2);
      },
    },

    {
      name: "get_open_orders",
      description:
        "List a wallet's resting (open, unfilled) orders on Hyperliquid. Each order in the response includes a pre-built cancel action that can be passed to cancel_order. If `user` is omitted, defaults to the server's trading key wallet.",
      inputSchema: z.object({
        user: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
      }),
      async handler(rawArgs) {
        const { user } = z
          .object({ user: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional() })
          .parse(rawArgs ?? {});
        const orders = await sdk.openOrders(user as `0x${string}` | undefined);
        return JSON.stringify(orders, null, 2);
      },
    },

    {
      name: "get_approval",
      description:
        "Check whether a wallet has approved Alchemy as a Hyperliquid builder, and at what max fee rate. Returns { approved, maxFeeRate, canTradePerps, canTradeSpot }. Use this before placing trades — if approved=false, the user needs to call approve_builder first.",
      inputSchema: z.object({
        user: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
      }),
      async handler(rawArgs) {
        const { user } = z
          .object({ user: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional() })
          .parse(rawArgs ?? {});
        const approval = await sdk.approval(user as `0x${string}` | undefined);
        return JSON.stringify(approval, null, 2);
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
      async handler(rawArgs) {
        const lock = requireSigner("place_market_order");
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
      async handler(rawArgs) {
        const lock = requireSigner("place_limit_order");
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
      async handler(rawArgs) {
        const lock = requireSigner("cancel_order");
        if (lock) return lock;
        const args = z
          .object({ symbol: z.string(), oid: z.number().int().positive() })
          .parse(rawArgs);
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
      name: "approve_builder",
      description:
        "Sign the one-time `approveBuilderFee` action authorizing Alchemy as a builder for the trading wallet. After this lands, all subsequent orders this wallet places auto-include the builder fee within the approved ceiling. `maxFeeRate` is a percent string like '1%' or '0.04%'. Call once during setup, before placing trades. Pass `maxFeeRate: '0%'` to revoke.",
      inputSchema: z.object({
        maxFeeRate: z
          .string()
          .regex(/^\d+(\.\d+)?%$/)
          .describe("Percent string like '1%' or '0.04%'. Pass '0%' to revoke."),
      }),
      async handler(rawArgs) {
        const lock = requireSigner("approve_builder");
        if (lock) return lock;
        const { maxFeeRate } = z
          .object({ maxFeeRate: z.string().regex(/^\d+(\.\d+)?%$/) })
          .parse(rawArgs);
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
