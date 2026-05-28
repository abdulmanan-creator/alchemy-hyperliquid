import type { FastifyInstance } from "fastify";

import type { MarketsResponse, PerpAsset, SpotAsset } from "@alchemy-hl/shared";

import { HlClient } from "../helpers/hlClient.js";

/**
 * GET /markets — fan out to Hyperliquid's `meta` (perps) + `spotMeta` (spot),
 * shape into our { perps, spot, hip3, hip4 } envelope.
 *
 * Hyperliquid's `meta` response:
 *   { universe: [{ name, szDecimals, maxLeverage, ... }, ...] }
 *   The asset index is the position in `universe`.
 *
 * Hyperliquid's `spotMeta` response:
 *   { universe: [{ name, index, tokens: [base, quote], ... }, ...],
 *     tokens:   [{ name, ... }, ...] }
 *   The asset index for spot orders is 10000 + index.
 *
 * HIP-3 dex enumeration lives at /dexes (separate route) since callers often
 * just want the perp/spot list without the dex hierarchy.
 */
export async function marketsRoute(app: FastifyInstance): Promise<void> {
  const hl = new HlClient({
    baseUrl: app.config.HYPERLIQUID_API_URL,
    logger: { warn: app.log.warn.bind(app.log) },
  });

  app.get("/markets", async (_req, reply) => {
    const [meta, spotMeta] = await Promise.all([
      hl.info<HlMeta>({ type: "meta" }),
      hl.info<HlSpotMeta>({ type: "spotMeta" }),
    ]);

    const perps: PerpAsset[] = (meta.universe ?? []).map((u, i) => ({
      name: u.name,
      szDecimals: u.szDecimals ?? 0,
      maxLeverage: u.maxLeverage ?? 1,
      assetIndex: i,
    }));

    const tokens = spotMeta.tokens ?? [];
    const spot: SpotAsset[] = (spotMeta.universe ?? []).map((u) => {
      const base = tokens[u.tokens?.[0] ?? 0];
      const quote = tokens[u.tokens?.[1] ?? 0];
      return {
        name: u.name,
        base: base?.name ?? "?",
        quote: quote?.name ?? "?",
        assetIndex: 10000 + (u.index ?? 0),
        szDecimals: base?.szDecimals ?? 0,
      };
    });

    const out: MarketsResponse = {
      perps,
      spot,
      // HIP-3 dexes live on /dexes; HIP-4 isn't enumerable yet.
      hip3: [],
      hip4: [],
    };

    return reply.send(out);
  });
}

// ---- HL response shapes (subset of what they return) ------------------------

interface HlMetaUniverse {
  name: string;
  szDecimals?: number;
  maxLeverage?: number;
}
interface HlMeta {
  universe: HlMetaUniverse[];
}

interface HlSpotToken {
  name: string;
  szDecimals?: number;
}
interface HlSpotUniverse {
  name: string;
  index?: number;
  tokens?: number[];
}
interface HlSpotMeta {
  universe: HlSpotUniverse[];
  tokens: HlSpotToken[];
}
