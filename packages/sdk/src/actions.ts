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
    p: toDecString(p.price),
    s: toDecString(p.size),
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
    p: toDecString(limit),
    s: toDecString(size),
    r: !!p.reduceOnly,
    t: { limit: { tif: "Ioc" } },
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
