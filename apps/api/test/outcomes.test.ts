/**
 * HIP-4 outcome markets: /outcomes enumeration, /outcomeOdds derivation, and
 * the contract that /exchange builds orders on outcome asset ids (100M+)
 * with the SPOT builder fee (HIP-4 builder fees are spot-style).
 */

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BuildResponse, OutcomeOddsResponse, OutcomesResponse } from "@alchemy-hl/shared";

import { loadConfig } from "../src/config.js";
import { ApiException, sendError } from "../src/errors.js";
import { exchangeRoute } from "../src/routes/exchange.js";
import { outcomesRoute } from "../src/routes/outcomes.js";

const baseEnv = {
  ALCHEMY_BUILDER_ADDRESS: "0xAAAA000000000000000000000000000000000001",
  HYPERLIQUID_API_URL: "https://api.hyperliquid-testnet.xyz",
  PERPS_BUILDER_FEE_BPS: "4",
  SPOT_BUILDER_FEE_BPS: "5",
} as unknown as NodeJS.ProcessEnv;

const OUTCOME_META = {
  outcomes: [
    {
      outcome: 104,
      name: "June Fed rate change",
      description: "Resolves to Change if …",
      sideSpecs: [{ name: "Change" }, { name: "No Change" }],
      quoteToken: "USDC",
    },
    {
      outcome: 142,
      name: "2026 NBA Finals champion",
      description: "Resolves to …",
      sideSpecs: [{ name: "San Antonio" }, { name: "New York" }],
      quoteToken: "USDC",
    },
  ],
};

async function buildApp(): Promise<FastifyInstance> {
  const cfg = loadConfig(baseEnv);
  const app = Fastify({ logger: false });
  app.decorate("config", cfg);
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiException) return sendError(reply, err);
    return reply.code(500).send({ error: "INTERNAL_ERROR", message: String(err) });
  });
  await outcomesRoute(app);
  await exchangeRoute(app);
  return app;
}

function jsonRes(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("HIP-4 outcomes", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse((init?.body as string) ?? "{}") as { type?: string; coin?: string };
      if (body.type === "outcomeMeta") return jsonRes(OUTCOME_META);
      if (body.type === "l2Book") {
        // Side 0 (#1040): two-sided book. Side 1 (#1041): empty book.
        if (body.coin === "#1040") {
          return jsonRes({ coin: body.coin, levels: [[{ px: "0.0082", sz: "1828" }], [{ px: "0.009", sz: "500" }]] });
        }
        return jsonRes({ coin: body.coin, levels: [[], []] });
      }
      throw new Error(`Unexpected info type: ${body.type}`);
    });
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("GET /outcomes shapes markets with the verified asset-id scheme", async () => {
    const res = await app.inject({ method: "GET", url: "/outcomes" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as OutcomesResponse;
    expect(body.outcomes).toHaveLength(2);
    const fed = body.outcomes[0]!;
    expect(fed.outcome).toBe(104);
    expect(fed.sides[0]).toEqual({
      side: 0,
      name: "Change",
      assetId: 100_001_040, // 100_000_000 + 10*104 + 0
      coin: "#1040",
    });
    expect(fed.sides[1].coin).toBe("#1041");
  });

  it("GET /outcomeOdds derives probability from book mids, null on empty books", async () => {
    const res = await app.inject({ method: "GET", url: "/outcomeOdds?outcome=104" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as OutcomeOddsResponse;
    expect(body.name).toBe("June Fed rate change");
    const [change, noChange] = body.sides;
    expect(change.probability).toBeCloseTo((0.0082 + 0.009) / 2, 9);
    expect(change.bestBid).toBe("0.0082");
    expect(noChange.probability).toBeNull();
  });

  it("GET /outcomeOdds rejects unknown ids with guidance", async () => {
    const res = await app.inject({ method: "GET", url: "/outcomeOdds?outcome=999999" });
    expect(res.statusCode).toBe(422);
    expect(res.json().guidance).toContain("/outcomes");
  });

  it("/exchange builds an outcome-asset order with the SPOT builder fee", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/exchange",
      payload: {
        action: {
          type: "order",
          grouping: "na",
          orders: [
            // Buy 25 "Change" contracts at 1.2% implied probability.
            { a: 100_001_040, b: true, p: "0.012", s: "25", r: false, t: { limit: { tif: "Gtc" } } },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const built = res.json() as BuildResponse;
    expect(built.isSpot).toBe(true);
    expect(built.builderFee).toBe(5); // SPOT_BUILDER_FEE_BPS, not perps' 4
    expect(built.typedData?.domain?.chainId).toBe(1337);
  });
});
