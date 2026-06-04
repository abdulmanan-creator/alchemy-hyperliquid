import type { FastifyInstance } from "fastify";

import type { MarketStat, MarketStatsResponse } from "@alchemy-hl/shared";

import { HlClient } from "../helpers/hlClient.js";

/**
 * GET /marketStats — live per-asset stats (mark px, 24h vol, OI, funding).
 *
 * Wraps HL's `metaAndAssetCtxs` (perps) + `spotMetaAndAssetCtxs` (spot).
 * Both return [meta, ctxs[]] — ctxs[i] is the live context for universe[i].
 *
 * We expose this as a separate endpoint from /markets so the symbol-resolver
 * hot path (called by the SDK + MCP) stays cheap. Dashboard consumers join
 * /markets (static metadata) with /marketStats (live numbers).
 */
export async function marketStatsRoute(app: FastifyInstance): Promise<void> {
  const hl = new HlClient({
    baseUrl: app.config.HYPERLIQUID_API_URL,
    logger: { warn: app.log.warn.bind(app.log) },
  });

  app.get("/marketStats", async (_req, reply) => {
    const [perpsResp, spotResp] = await Promise.all([
      hl.info<[HlMeta, HlPerpCtx[]]>({ type: "metaAndAssetCtxs" }),
      hl.info<[HlSpotMeta, HlSpotCtx[]]>({ type: "spotMetaAndAssetCtxs" }),
    ]);

    const [perpMeta, perpCtxs] = perpsResp;
    const perps: MarketStat[] = (perpMeta.universe ?? []).map((u, i) => {
      const c = perpCtxs[i];
      return {
        assetIndex: i,
        name: u.name,
        markPx: c?.markPx,
        midPx: c?.midPx,
        prevDayPx: c?.prevDayPx,
        dayNtlVlm: c?.dayNtlVlm,
        openInterest: c?.openInterest,
        funding: c?.funding,
      };
    });

    const [spotMeta, spotCtxs] = spotResp;
    const spot: MarketStat[] = (spotMeta.universe ?? []).map((u, i) => {
      const c = spotCtxs[i];
      return {
        assetIndex: 10000 + (u.index ?? 0),
        name: u.name,
        markPx: c?.markPx,
        midPx: c?.midPx,
        prevDayPx: c?.prevDayPx,
        dayNtlVlm: c?.dayNtlVlm,
      };
    });

    const out: MarketStatsResponse = { perps, spot };
    return reply.send(out);
  });
}

// ---- HL response shapes -----------------------------------------------------

interface HlMetaUniverse {
  name: string;
}
interface HlMeta {
  universe: HlMetaUniverse[];
}
interface HlPerpCtx {
  markPx?: string;
  midPx?: string;
  prevDayPx?: string;
  dayNtlVlm?: string;
  openInterest?: string;
  funding?: string;
}

interface HlSpotUniverse {
  name: string;
  index?: number;
}
interface HlSpotMeta {
  universe: HlSpotUniverse[];
}
interface HlSpotCtx {
  markPx?: string;
  midPx?: string;
  prevDayPx?: string;
  dayNtlVlm?: string;
}
