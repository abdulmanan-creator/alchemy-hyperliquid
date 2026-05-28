/**
 * Builder-info injection + cap enforcement for L1 `order` actions.
 *
 * Hyperliquid asset-index convention:
 *   - 0       … N_perps - 1   → perps  (asset = perp index)
 *   - 10000   … 10000 + N_spot → spot  (asset = 10000 + spot pair index)
 *
 * We treat any leg with asset >= SPOT_OFFSET as spot. If a single order action
 * mixes perps and spot legs (rare but possible), we apply the *higher* fee bps
 * across all legs — the protocol applies a single builder fee to the whole
 * action.
 */

import type { BuilderInfo, OrderAction } from "@alchemy-hl/shared";

import type { Config } from "../config.js";
import { ApiException } from "../errors.js";

const SPOT_OFFSET = 10000;

export function isSpotAsset(assetIndex: number): boolean {
  return assetIndex >= SPOT_OFFSET;
}

/**
 * True iff *any* leg of the order targets a spot asset.
 */
export function orderHasSpot(action: OrderAction): boolean {
  return action.orders.some((o) => isSpotAsset(o.a));
}

/**
 * Pick the fee bps to inject. Mixed order → take the larger (the higher-cap
 * surface). Single-surface order → that surface's configured fee.
 */
export function feeBpsFor(action: OrderAction, cfg: Config): number {
  const anySpot = action.orders.some((o) => isSpotAsset(o.a));
  const anyPerp = action.orders.some((o) => !isSpotAsset(o.a));
  if (anySpot && !anyPerp) return cfg.SPOT_BUILDER_FEE_BPS;
  if (anyPerp && !anySpot) return cfg.PERPS_BUILDER_FEE_BPS;
  // Mixed: take the larger so we don't undercharge on the spot legs.
  return Math.max(cfg.PERPS_BUILDER_FEE_BPS, cfg.SPOT_BUILDER_FEE_BPS);
}

/**
 * Mutate `action.builder` to point at Alchemy's address with the configured
 * fee. Returns the resolved BuilderInfo so the caller can echo it back in
 * the BuildResponse.
 *
 * Throws BUILDER_MISMATCH if the caller supplied a builder pointing at someone
 * else. Throws INVALID_PARAMS if the resolved fee exceeds the protocol cap.
 */
export function injectBuilder(action: OrderAction, cfg: Config): BuilderInfo {
  // If a caller supplied builder info, it must match ours. Don't let a client
  // sneak a different builder address (or a higher fee) through.
  if (action.builder) {
    if (action.builder.b.toLowerCase() !== cfg.builderAddressLower) {
      throw new ApiException(
        "BUILDER_MISMATCH",
        `Action's builder ${action.builder.b} does not match Alchemy's ${cfg.ALCHEMY_BUILDER_ADDRESS}.`,
        "Remove the builder field from your action — the server attaches it for you.",
      );
    }
  }

  const fee = feeBpsFor(action, cfg);
  const cap = orderHasSpot(action)
    ? cfg.MAX_BUILDER_FEE_BPS_SPOT
    : cfg.MAX_BUILDER_FEE_BPS_PERPS;

  if (fee > cap) {
    throw new ApiException(
      "INVALID_PARAMS",
      `Configured fee ${fee} bps exceeds protocol cap ${cap} bps.`,
      "Lower the PERPS_BUILDER_FEE_BPS / SPOT_BUILDER_FEE_BPS env var. Protocol caps are 10/100 for perps/spot.",
    );
  }

  const info: BuilderInfo = { b: cfg.ALCHEMY_BUILDER_ADDRESS, f: fee };
  action.builder = info;
  return info;
}
