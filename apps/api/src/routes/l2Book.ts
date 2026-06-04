import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";

import type { L2BookResponse } from "@alchemy-hl/shared";

import { ApiException } from "../errors.js";
import { HlClient } from "../helpers/hlClient.js";

/**
 * GET /l2Book?coin=BTC&nSigFigs=5 — top-of-book snapshot for one asset.
 *
 * Wraps HL's `l2Book` info type. `coin` is the symbol (BTC, ETH, HYPE, etc.).
 * `nSigFigs` (optional) controls the price-bucket aggregation HL applies on
 * the server — 5 (default) is fine for a dashboard preview.
 *
 * Returns up to a few hundred levels per side; the FE typically just shows
 * the top 5-10. We don't truncate here — let the caller decide.
 */
export async function l2BookRoute(app: FastifyInstance): Promise<void> {
  const hl = new HlClient({
    baseUrl: app.config.HYPERLIQUID_API_URL,
    logger: { warn: app.log.warn.bind(app.log) },
  });

  app.get("/l2Book", async (req, reply) => {
    let q;
    try {
      q = z
        .object({
          coin: z.string().min(1),
          nSigFigs: z.coerce.number().int().min(2).max(5).optional(),
        })
        .parse(req.query);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ApiException(
          "INVALID_PARAMS",
          "Bad query: provide ?coin=BTC (and optionally &nSigFigs=2..5).",
          "coin is the asset symbol as it appears in /markets.",
        );
      }
      throw err;
    }

    const body: { type: "l2Book"; coin: string; nSigFigs?: number } = {
      type: "l2Book",
      coin: q.coin,
    };
    if (q.nSigFigs !== undefined) body.nSigFigs = q.nSigFigs;

    const resp = await hl.info<L2BookResponse>(body);
    return reply.send(resp);
  });
}
