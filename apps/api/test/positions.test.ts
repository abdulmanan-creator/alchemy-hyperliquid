/**
 * GET /positions — clearinghouseState assetPositions → shaped position list.
 */

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PositionsResponse } from "@alchemy-hl/shared";

import { loadConfig } from "../src/config.js";
import { ApiException, sendError } from "../src/errors.js";
import { positionsRoute } from "../src/routes/positions.js";

const USER = "0xcccc000000000000000000000000000000000001";

const baseEnv = {
  ALCHEMY_BUILDER_ADDRESS: "0xAAAA000000000000000000000000000000000001",
  HYPERLIQUID_API_URL: "https://api.hyperliquid-testnet.xyz",
  PERPS_BUILDER_FEE_BPS: "4",
  SPOT_BUILDER_FEE_BPS: "5",
} as unknown as NodeJS.ProcessEnv;

async function buildApp(): Promise<FastifyInstance> {
  const cfg = loadConfig(baseEnv);
  const app = Fastify({ logger: false });
  app.decorate("config", cfg);
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiException) return sendError(reply, err);
    return reply.code(500).send({ error: "INTERNAL_ERROR", message: String(err) });
  });
  await positionsRoute(app);
  return app;
}

function mockClearinghouse(assetPositions: unknown[]) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ assetPositions }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("GET /positions", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("shapes long and short positions with signed-size split into side", async () => {
    mockClearinghouse([
      {
        type: "oneWay",
        position: {
          coin: "BTC",
          szi: "0.5",
          entryPx: "97000.0",
          positionValue: "48500.0",
          unrealizedPnl: "120.5",
          returnOnEquity: "0.0248",
          liquidationPx: "60000.0",
          leverage: { type: "cross", value: 10 },
          marginUsed: "4850.0",
        },
      },
      {
        type: "oneWay",
        position: {
          coin: "ETH",
          szi: "-2",
          entryPx: "3500.0",
          positionValue: "7000.0",
          unrealizedPnl: "-35.0",
          returnOnEquity: "-0.01",
          liquidationPx: null,
          leverage: { type: "isolated", value: 5 },
          marginUsed: "1400.0",
        },
      },
    ]);

    const res = await app.inject({ method: "GET", url: `/positions?user=${USER}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PositionsResponse;
    expect(body.user).toBe(USER);
    expect(body.positions).toHaveLength(2);

    const [btc, eth] = body.positions;
    expect(btc).toMatchObject({
      coin: "BTC",
      size: "0.5",
      side: "long",
      entryPx: "97000.0",
      unrealizedPnl: "120.5",
      liquidationPx: "60000.0",
      leverage: 10,
      leverageMode: "cross",
    });
    expect(eth).toMatchObject({
      coin: "ETH",
      size: "2",
      side: "short",
      liquidationPx: null,
      leverage: 5,
      leverageMode: "isolated",
    });
  });

  it("returns an empty list for a flat account", async () => {
    mockClearinghouse([]);
    const res = await app.inject({ method: "GET", url: `/positions?user=${USER}` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as PositionsResponse).positions).toEqual([]);
  });

  it("drops zero-size dust entries and tolerates missing fields", async () => {
    mockClearinghouse([
      { type: "oneWay", position: { coin: "SOL", szi: "0" } },
      { type: "oneWay", position: { coin: "DOGE", szi: "100" } },
      { type: "oneWay" }, // no position field at all
    ]);
    const res = await app.inject({ method: "GET", url: `/positions?user=${USER}` });
    const body = res.json() as PositionsResponse;
    expect(body.positions).toHaveLength(1);
    expect(body.positions[0]).toMatchObject({
      coin: "DOGE",
      side: "long",
      entryPx: "0",
      leverage: 1,
      leverageMode: "cross",
    });
  });

  it("422 on missing/invalid user", async () => {
    const res = await app.inject({ method: "GET", url: "/positions?user=nope" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("INVALID_PARAMS");
  });
});
