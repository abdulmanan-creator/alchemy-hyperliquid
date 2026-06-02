import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";

import { ApiException } from "../errors.js";
import { HlClient } from "../helpers/hlClient.js";

/**
 * GET /markPrice?asset=0 — returns HL's current mid price for an asset.
 *
 * Used by the TestTradeCard to compute realistic notional estimates (using
 * the actual fill price, not the user's intentionally-high IOC limit price)
 * and by any future order-sizing helpers.
 *
 * Internally proxies HL's `allMids` info call and indexes by `coinIndex`,
 * which for perps is the same as the asset index used in order actions.
 * Spot asset indices (10000+) use HL's spot universe naming — not supported
 * by allMids; out-of-scope for this endpoint.
 */
export async function markPriceRoute(app: FastifyInstance): Promise<void> {
  const hl = new HlClient({
    baseUrl: app.config.HYPERLIQUID_API_URL,
    logger: { warn: app.log.warn.bind(app.log) },
  });

  const QuerySchema = z.object({
    asset: z.coerce.number().int().min(0),
  });

  app.get("/markPrice", async (req, reply) => {
    let q;
    try {
      q = QuerySchema.parse(req.query);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ApiException(
          "INVALID_PARAMS",
          "Bad query: ?asset must be a non-negative integer.",
          "Send ?asset=0 for BTC perp, 1 for ETH perp, etc.",
        );
      }
      throw err;
    }

    // allMids returns an object map keyed by coin name. To map asset index
    // → coin name we'd need a separate meta call; HL also returns a list-by-
    // index in some payloads. Simplest correct approach: fetch meta + allMids
    // in parallel, lookup name from universe[asset].name, then read allMids[name].
    const [meta, mids] = await Promise.all([
      hl.info<{ universe: { name: string }[] }>({ type: "meta" }),
      hl.info<Record<string, string>>({ type: "allMids" }),
    ]);

    const coin = meta?.universe?.[q.asset]?.name;
    if (!coin) {
      throw new ApiException(
        "INVALID_PARAMS",
        `No asset at index ${q.asset}.`,
        "Pick a valid asset index — GET /markets lists them.",
      );
    }

    const mid = mids?.[coin];
    if (!mid) {
      throw new ApiException(
        "INVALID_PARAMS",
        `No mid price returned by HL for ${coin}.`,
        "HL didn't include this asset in allMids — may be paused or delisted.",
      );
    }

    return reply.send({ asset: q.asset, coin, mid });
  });
}
