import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ZodError } from "zod";

import type {
  OutcomeMarket,
  OutcomeOddsResponse,
  OutcomeSide,
  OutcomeSideOdds,
  OutcomesResponse,
} from "@alchemy-hl/shared";

import { ApiException } from "../errors.js";
import { HlClient } from "../helpers/hlClient.js";
import { TtlCache, cachedAsync } from "../helpers/ttlCache.js";

/**
 * HIP-4 outcome (prediction) markets.
 *
 *   GET /outcomes            — enumerate markets from HL's `outcomeMeta`
 *   GET /outcomeOdds?outcome=N — live odds for one market (l2Book midpoints)
 *
 * Asset scheme (verified against mainnet):
 *   encoding = 10 * outcome + side
 *   assetId  = 100_000_000 + encoding   ← `a` field for /exchange orders
 *   coin     = "#" + encoding           ← l2Book coin
 *
 * Orders on these assets route through the normal /exchange path. Builder
 * fees apply spot-style — assetId >= 10000 already classifies as spot in
 * helpers/builder.ts, so injection works unchanged.
 */
export async function outcomesRoute(app: FastifyInstance): Promise<void> {
  const hl = new HlClient({
    baseUrl: app.config.HYPERLIQUID_API_URL,
    logger: { warn: app.log.warn.bind(app.log) },
  });

  // Market list changes on listing cadence; odds change constantly. Cache the
  // enumeration for 60s, never the books.
  const metaCache = new TtlCache<Promise<OutcomesResponse>>({ ttlMs: 60_000, maxEntries: 4 });

  app.get("/outcomes", async (_req, reply) => {
    const out = await cachedAsync(metaCache, "outcomes", () => fetchOutcomes(hl));
    return reply.send(out);
  });

  app.get("/outcomeOdds", async (req, reply) => {
    let outcome: number;
    try {
      ({ outcome } = z
        .object({ outcome: z.coerce.number().int().min(0) })
        .parse(req.query));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ApiException(
          "INVALID_PARAMS",
          "Bad query: provide ?outcome=<id>",
          "Use the `outcome` id from GET /outcomes.",
        );
      }
      throw err;
    }

    const { outcomes } = await cachedAsync(metaCache, "outcomes", () => fetchOutcomes(hl));
    const market = outcomes.find((o) => o.outcome === outcome);
    if (!market) {
      throw new ApiException(
        "INVALID_PARAMS",
        `Unknown outcome id ${outcome}.`,
        "Enumerate live markets via GET /outcomes and use one of those ids.",
      );
    }

    const sides = (await Promise.all(
      market.sides.map(async (side): Promise<OutcomeSideOdds> => {
        const book = await hl.info<HlL2Book>({ type: "l2Book", coin: side.coin });
        const bestBid = book?.levels?.[0]?.[0]?.px ?? null;
        const bestAsk = book?.levels?.[1]?.[0]?.px ?? null;
        return { ...side, bestBid, bestAsk, probability: impliedProbability(bestBid, bestAsk) };
      }),
    )) as OutcomeOddsResponse["sides"];

    const out: OutcomeOddsResponse = {
      outcome: market.outcome,
      name: market.name,
      quoteToken: market.quoteToken,
      sides,
    };
    return reply.send(out);
  });
}

async function fetchOutcomes(hl: HlClient): Promise<OutcomesResponse> {
  const raw = await hl.info<HlOutcomeMeta>({ type: "outcomeMeta" });
  const outcomes: OutcomeMarket[] = (raw?.outcomes ?? [])
    .filter((o) => typeof o?.outcome === "number" && Array.isArray(o.sideSpecs))
    .map((o) => ({
      outcome: o.outcome,
      name: o.name ?? `Outcome ${o.outcome}`,
      description: o.description ?? "",
      sides: [makeSide(o.outcome, 0, o.sideSpecs), makeSide(o.outcome, 1, o.sideSpecs)],
      quoteToken: o.quoteToken ?? "USDC",
    }));
  return { outcomes };
}

function makeSide(
  outcome: number,
  side: 0 | 1,
  sideSpecs: Array<{ name?: string }>,
): OutcomeSide {
  const encoding = 10 * outcome + side;
  return {
    side,
    name: sideSpecs[side]?.name ?? (side === 0 ? "Yes" : "No"),
    assetId: 100_000_000 + encoding,
    coin: `#${encoding}`,
  };
}

/**
 * Book midpoint as the implied probability. One-sided books fall back to the
 * present side; an empty book yields null rather than a fake 50%.
 */
function impliedProbability(bestBid: string | null, bestAsk: string | null): number | null {
  const bid = bestBid !== null ? Number(bestBid) : null;
  const ask = bestAsk !== null ? Number(bestAsk) : null;
  if (bid !== null && ask !== null) return (bid + ask) / 2;
  if (bid !== null) return bid;
  if (ask !== null) return ask;
  return null;
}

// ---- HL response shapes (subset) --------------------------------------------

interface HlOutcomeMeta {
  outcomes: Array<{
    outcome: number;
    name?: string;
    description?: string;
    sideSpecs: Array<{ name?: string }>;
    quoteToken?: string;
  }>;
}

interface HlL2Book {
  levels?: [Array<{ px: string }>, Array<{ px: string }>];
}
