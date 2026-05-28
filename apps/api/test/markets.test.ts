/**
 * GET /markets + GET /dexes tests.
 *
 * Both routes are thin shapers over HL's info endpoint, so the coverage we
 * want is:
 *   - Round-trip a representative HL response → our envelope shape.
 *   - Tolerate missing/null fields without crashing (HL is generous with nulls).
 */

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DexesResponse, MarketsResponse } from "@alchemy-hl/shared";

import { loadConfig } from "../src/config.js";
import { ApiException, sendError } from "../src/errors.js";
import { marketsRoute } from "../src/routes/markets.js";
import { dexesRoute } from "../src/routes/dexes.js";

const baseEnv = {
  ALCHEMY_BUILDER_ADDRESS: "0xAAAA000000000000000000000000000000000001",
  HYPERLIQUID_API_URL: "https://api.hyperliquid-testnet.xyz",
  PERPS_BUILDER_FEE_BPS: "4",
  SPOT_BUILDER_FEE_BPS: "5",
} as unknown as NodeJS.ProcessEnv;

async function buildApp(register: (a: FastifyInstance) => Promise<void>) {
  const cfg = loadConfig(baseEnv);
  const app = Fastify({ logger: false });
  app.decorate("config", cfg);
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiException) return sendError(reply, err);
    return reply.code(500).send({ error: "INTERNAL_ERROR", message: String(err) });
  });
  await register(app);
  return app;
}

function mockInfo(...responses: unknown[]): ReturnType<typeof vi.spyOn> {
  const spy = vi.spyOn(globalThis, "fetch");
  for (const r of responses) {
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify(r), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }
  return spy;
}

describe("GET /markets", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp(marketsRoute);
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("shapes meta + spotMeta into MarketsResponse", async () => {
    mockInfo(
      // meta
      {
        universe: [
          { name: "BTC", szDecimals: 4, maxLeverage: 50 },
          { name: "ETH", szDecimals: 4, maxLeverage: 50 },
        ],
      },
      // spotMeta
      {
        tokens: [
          { name: "USDC", szDecimals: 6 },
          { name: "PURR", szDecimals: 0 },
        ],
        universe: [{ name: "PURR/USDC", index: 0, tokens: [1, 0] }],
      },
    );

    const res = await app.inject({ method: "GET", url: "/markets" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as MarketsResponse;
    expect(body.perps).toHaveLength(2);
    expect(body.perps[0]).toEqual({
      name: "BTC",
      szDecimals: 4,
      maxLeverage: 50,
      assetIndex: 0,
    });
    expect(body.perps[1]?.assetIndex).toBe(1);
    expect(body.spot).toHaveLength(1);
    expect(body.spot[0]).toEqual({
      name: "PURR/USDC",
      base: "PURR",
      quote: "USDC",
      assetIndex: 10000,
      szDecimals: 0,
    });
  });

  it("survives empty/missing fields", async () => {
    mockInfo({ universe: [] }, { tokens: [], universe: [] });
    const res = await app.inject({ method: "GET", url: "/markets" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as MarketsResponse;
    expect(body.perps).toEqual([]);
    expect(body.spot).toEqual([]);
    expect(body.hip3).toEqual([]);
    expect(body.hip4).toEqual([]);
  });
});

describe("GET /dexes", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp(dexesRoute);
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("filters null slot 0 and shapes the rest", async () => {
    mockInfo([
      null,
      { name: "test-dex", full_name: "0xbeef000000000000000000000000000000000000" },
    ]);
    const res = await app.inject({ method: "GET", url: "/dexes" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as DexesResponse;
    expect(body.dexes).toHaveLength(1);
    expect(body.dexes[0]?.name).toBe("test-dex");
  });

  it("returns empty list when HL returns []", async () => {
    mockInfo([]);
    const res = await app.inject({ method: "GET", url: "/dexes" });
    expect(res.json()).toEqual({ dexes: [] });
  });
});
