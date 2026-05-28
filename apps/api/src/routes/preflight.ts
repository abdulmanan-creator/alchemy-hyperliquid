import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { ApiException } from "../errors.js";
import { feeBpsFor, isSpotAsset, orderHasSpot } from "../helpers/builder.js";
import { PreflightBodySchema } from "../schemas.js";

/**
 * POST /preflight — validate an order without signing.
 *
 * Useful for "Try it" panels and SDK dry-runs: lets the caller see the
 * builder fee that *would* be charged, which surface the order routes
 * through (perps vs spot), and any shape errors — without producing a hash
 * the user could sign.
 *
 * The validation is local: zod on the action shape + cap re-check on the
 * resolved fee. We don't hit Hyperliquid because there's nothing to learn
 * from them at this stage (asset existence + price ticks are validated at
 * send-time anyway).
 */
export async function preflightRoute(app: FastifyInstance): Promise<void> {
  app.post("/preflight", async (req, reply) => {
    let parsed;
    try {
      parsed = PreflightBodySchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        const errors = err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        }));
        return reply.send({
          valid: false,
          errors,
          assetInfo: null,
          estimatedFee: null,
          isSpot: false,
        });
      }
      throw new ApiException(
        "INVALID_JSON",
        "Could not parse the request body.",
        "Send a JSON object with an `action` field shaped like an order.",
      );
    }

    const action = parsed.action;
    const fee = feeBpsFor(action, app.config);
    const cap = orderHasSpot(action)
      ? app.config.MAX_BUILDER_FEE_BPS_SPOT
      : app.config.MAX_BUILDER_FEE_BPS_PERPS;

    const errors: { path: string; message: string }[] = [];
    if (fee > cap) {
      errors.push({
        path: "builder.f",
        message: `Resolved fee ${fee} bps exceeds protocol cap ${cap} bps.`,
      });
    }
    // Reject mixed perps+spot orders here; HL will reject too but it's friendlier
    // to surface in preflight.
    const anySpot = action.orders.some((o) => isSpotAsset(o.a));
    const anyPerp = action.orders.some((o) => !isSpotAsset(o.a));
    if (anySpot && anyPerp) {
      errors.push({
        path: "orders",
        message:
          "Mixed perps + spot legs in one action are not supported by Hyperliquid. Split into two actions.",
      });
    }

    const assetInfo = action.orders.map((o) => ({
      assetIndex: o.a,
      side: o.b ? "buy" : "sell",
      price: o.p,
      size: o.s,
      isSpot: isSpotAsset(o.a),
    }));

    return reply.send({
      valid: errors.length === 0,
      errors,
      assetInfo,
      estimatedFee: { bps: fee, surface: anySpot && !anyPerp ? "spot" : "perps" },
      isSpot: orderHasSpot(action),
    });
  });
}
