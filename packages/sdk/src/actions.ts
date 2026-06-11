/**
 * Action builders. Translate ergonomic SDK params into the wire-format action
 * objects HL's /exchange consumes. The backend's /exchange build endpoint
 * will inject the builder + fee; the SDK doesn't have to worry about that.
 */

import type {
  ApproveBuilderFeeAction,
  CancelAction,
  OrderAction,
  OrderLeg,
} from "@alchemy-hl/shared";

import { SdkInputError } from "./errors.js";

export type Tif = "Alo" | "Gtc" | "Ioc";

export interface LimitOrderParams {
  /** Asset index from the symbol resolver. */
  assetIndex: number;
  /**
   * Asset size precision (decimals). Sizes get truncated to this many
   * decimal places; HL's /exchange serde rejects orders with more decimals.
   * Required because passing an over-precise size silently fails with
   * an unhelpful HTTP 422 "Failed to deserialize" error from HL.
   */
  szDecimals: number;
  /** True for spot pairs (asset >= 10000). Affects price precision rules. */
  isSpot?: boolean;
  side: "buy" | "sell";
  /** Order size in base units (e.g. 0.001 BTC). */
  size: string | number;
  /** Limit price as decimal. */
  price: string | number;
  /** Time-in-force. Default "Gtc". */
  tif?: Tif;
  /** Reduce-only — closes existing position, won't open a new one. */
  reduceOnly?: boolean;
  /** Optional 32-byte client order id. */
  cloid?: `0x${string}`;
}

export interface MarketOrderParams {
  assetIndex: number;
  /** See LimitOrderParams.szDecimals. */
  szDecimals: number;
  /** See LimitOrderParams.isSpot. */
  isSpot?: boolean;
  side: "buy" | "sell";
  /** Order size in base units. Mutually exclusive with `notional`. */
  size?: string | number;
  /**
   * USD notional. Combined with `markPrice` (caller-fetched), the SDK
   * computes size = notional / markPrice. Mutually exclusive with `size`.
   */
  notional?: string | number;
  /** Caller-provided mark price (from sdk.markPrice()). Required if using `notional`. */
  markPrice?: string | number;
  /** Slippage tolerance in bps. Default 50 (0.5%). */
  slippageBps?: number;
  reduceOnly?: boolean;
  cloid?: `0x${string}`;
}

export function buildLimitOrder(p: LimitOrderParams): OrderAction {
  const leg: OrderLeg = {
    a: p.assetIndex,
    b: p.side === "buy",
    p: roundPrice(p.price, p.szDecimals, !!p.isSpot),
    s: roundSize(p.size, p.szDecimals),
    r: !!p.reduceOnly,
    t: { limit: { tif: p.tif ?? "Gtc" } },
  };
  if (p.cloid) leg.c = p.cloid;
  return { type: "order", grouping: "na", orders: [leg] };
}

/**
 * Build a marketable IOC order from either size or notional. The limit price
 * is set to (markPrice ± slippage); IOC fills against the book up to that
 * price and cancels the rest. The actual fill price is whatever's on the
 * book, not the limit.
 */
export function buildMarketOrder(p: MarketOrderParams): OrderAction {
  if (p.size === undefined && p.notional === undefined) {
    throw new SdkInputError("marketOrder requires either `size` or `notional`.");
  }
  if (p.size !== undefined && p.notional !== undefined) {
    throw new SdkInputError("marketOrder accepts `size` OR `notional`, not both.");
  }
  if (p.notional !== undefined && p.markPrice === undefined) {
    throw new SdkInputError(
      "marketOrder with `notional` requires `markPrice` (fetch via sdk.markPrice(symbol)).",
    );
  }

  const mark = p.markPrice !== undefined ? Number(p.markPrice) : null;
  const size =
    p.size !== undefined ? Number(p.size) : Number(p.notional!) / mark!;

  const slip = (p.slippageBps ?? 50) / 10_000;
  const limit = mark
    ? p.side === "buy"
      ? mark * (1 + Math.max(slip, 0.05))
      : mark * (1 - Math.max(slip, 0.05))
    : // No mark price → use sentinel limits far from any market.
    p.side === "buy"
    ? 1e12
    : 1;

  const leg: OrderLeg = {
    a: p.assetIndex,
    b: p.side === "buy",
    p: roundPrice(limit, p.szDecimals, !!p.isSpot),
    s: roundSize(size, p.szDecimals),
    r: !!p.reduceOnly,
    t: { limit: { tif: "Ioc" } },
  };
  if (p.cloid) leg.c = p.cloid;
  return { type: "order", grouping: "na", orders: [leg] };
}

export interface TriggerOrderParams {
  assetIndex: number;
  /** See LimitOrderParams.szDecimals. */
  szDecimals: number;
  /** See LimitOrderParams.isSpot. */
  isSpot?: boolean;
  /** Direction of the trigger order itself (to close a long, this is "sell"). */
  side: "buy" | "sell";
  /** Order size in base units. */
  size: string | number;
  /** Price at which the trigger fires (HL mark-price based). */
  triggerPrice: string | number;
  /** "tp" = take-profit, "sl" = stop-loss. Affects HL's trigger semantics. */
  tpsl: "tp" | "sl";
  /**
   * Execute as market when triggered (default true). When false, the order
   * rests at `limitPrice` after triggering.
   */
  isMarket?: boolean;
  /**
   * Limit price once triggered. Required when `isMarket` is false. For
   * market triggers it bounds the worst acceptable fill — defaults to
   * triggerPrice ± 10% in the aggressive direction.
   */
  limitPrice?: string | number;
  /** TP/SL protect an existing position, so this defaults to TRUE. */
  reduceOnly?: boolean;
  cloid?: `0x${string}`;
}

/**
 * Build a standalone trigger order (take-profit or stop-loss). Uses HL's
 * trigger leg type: fires when mark price crosses `triggerPrice`, then
 * executes as market (default) or rests at `limitPrice`.
 */
export function buildTriggerOrder(p: TriggerOrderParams): OrderAction {
  if (p.isMarket === false && p.limitPrice === undefined) {
    throw new SdkInputError(
      "Trigger order with isMarket=false requires `limitPrice` (the price the order rests at after triggering).",
    );
  }
  const trigger = Number(p.triggerPrice);
  if (!Number.isFinite(trigger) || trigger <= 0) {
    throw new SdkInputError(`triggerPrice must be a positive number, got: ${p.triggerPrice}`);
  }
  // Market triggers still carry a limit price on the wire — it bounds the
  // worst acceptable fill. Default: 10% beyond the trigger in the aggressive
  // direction (buy fills up to +10%, sell down to -10%).
  const limit =
    p.limitPrice !== undefined
      ? Number(p.limitPrice)
      : p.side === "buy"
        ? trigger * 1.1
        : trigger * 0.9;

  const leg: OrderLeg = {
    a: p.assetIndex,
    b: p.side === "buy",
    p: roundPrice(limit, p.szDecimals, !!p.isSpot),
    s: roundSize(p.size, p.szDecimals),
    r: p.reduceOnly ?? true,
    t: {
      trigger: {
        isMarket: p.isMarket ?? true,
        triggerPx: roundPrice(trigger, p.szDecimals, !!p.isSpot),
        tpsl: p.tpsl,
      },
    },
  };
  if (p.cloid) leg.c = p.cloid;
  return { type: "order", grouping: "na", orders: [leg] };
}

export function buildCancel(items: { assetIndex: number; oid: number }[]): CancelAction {
  if (!items.length) throw new SdkInputError("cancel requires at least one item.");
  return {
    type: "cancel",
    cancels: items.map((i) => ({ a: i.assetIndex, o: i.oid })),
  };
}

export function buildUpdateLeverage(opts: {
  assetIndex: number;
  leverage: number;
  isCross?: boolean;
}): import("@alchemy-hl/shared").UpdateLeverageAction {
  if (!Number.isInteger(opts.leverage) || opts.leverage < 1) {
    throw new SdkInputError("leverage must be a positive integer.");
  }
  return {
    type: "updateLeverage",
    asset: opts.assetIndex,
    isCross: opts.isCross ?? true,
    leverage: opts.leverage,
  };
}

export function buildApproveBuilderFee(maxFeeRate: string): ApproveBuilderFeeAction {
  if (!/^\d+(\.\d+)?%$/.test(maxFeeRate)) {
    throw new SdkInputError(
      `maxFeeRate must be a percent string like "1%" or "0.04%", got: "${maxFeeRate}"`,
    );
  }
  return { type: "approveBuilderFee", maxFeeRate };
}

/**
 * HL is picky about price/size string format. Use viem-style decimal toString,
 * strip trailing zeros, never produce scientific notation. Mirrors the
 * `float_to_wire` helper in HL's Python SDK.
 */
function toDecString(n: string | number): string {
  if (typeof n === "string") return n;
  if (!Number.isFinite(n)) throw new SdkInputError(`Non-finite number: ${n}`);
  // Avoid scientific notation for very small / large numbers.
  const s = n.toFixed(10);
  return s.replace(/\.?0+$/, "");
}

/**
 * HL's /exchange serde validates that an order's price + size strings fit
 * the asset's precision rules. Submitting a size with more decimals than
 * `szDecimals` fails to deserialize with the unhelpful error "Failed to
 * deserialize the JSON body into the target type" (HTTP 422). Rules:
 *
 *   size:  ≤ szDecimals decimal places (truncate; rounding up could exceed
 *          the user's actual balance)
 *   price: ≤ (MAX_DECIMALS - szDecimals) decimal places, where MAX_DECIMALS
 *          is 6 for perps / 8 for spot. Plus the "5 significant figures"
 *          ceiling: only the first 5 sig figs of the price are honored.
 *
 * Source: HL's float_to_wire / round helpers in their Python SDK. We mirror
 * the same logic so SDK output matches what HL accepts on both /exchange
 * and /agent/exchange paths.
 */
const MAX_PRICE_DECIMALS_PERPS = 6;
const MAX_PRICE_DECIMALS_SPOT = 8;
const MAX_PRICE_SIG_FIGS = 5;

function roundSize(size: string | number, szDecimals: number): string {
  const n = typeof size === "number" ? size : Number(size);
  if (!Number.isFinite(n)) throw new SdkInputError(`Non-finite size: ${size}`);
  // Truncate toward zero so we never submit a size larger than the caller's
  // intent (and never exceed margin in the rounding direction).
  const factor = 10 ** szDecimals;
  const truncated = Math.trunc(n * factor) / factor;
  return toDecString(truncated);
}

function roundPrice(price: string | number, szDecimals: number, isSpot: boolean): string {
  const n = typeof price === "number" ? price : Number(price);
  if (!Number.isFinite(n)) throw new SdkInputError(`Non-finite price: ${price}`);
  if (n === 0) return "0";

  const maxDecimals = isSpot ? MAX_PRICE_DECIMALS_SPOT : MAX_PRICE_DECIMALS_PERPS;
  const decimalsAllowed = Math.max(0, maxDecimals - szDecimals);

  // 1) Cap decimal places.
  const decimalRounded = Number(n.toFixed(decimalsAllowed));

  // 2) Cap significant figures. For a number like 12345.678, exp = 4 (1e4),
  //    so to keep 5 sig figs we round to 0 decimals → "12346". For 0.000123,
  //    exp = -4, sig-fig count to keep is 5 - (-4) - 1 = 8 decimals.
  const exp = Math.floor(Math.log10(Math.abs(decimalRounded)));
  const decimalsForSigFigs = Math.max(0, MAX_PRICE_SIG_FIGS - 1 - exp);
  const finalDecimals = Math.min(decimalsAllowed, decimalsForSigFigs);
  const rounded = Number(decimalRounded.toFixed(finalDecimals));

  return toDecString(rounded);
}
