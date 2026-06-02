/**
 * GET /markPrice tests. Quick coverage:
 *   - happy path: returns coin + mid for a valid asset index
 *   - missing asset → INVALID_PARAMS
 *   - allMids doesn't include the coin → INVALID_PARAMS
 */

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import { ApiException, sendError } from "../src/errors.js";
import { markPriceRoute } from "../src/routes/markPrice.js";

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
  await markPriceRoute(app);
  return app;
}

function mockInfo(...bodies: unknown[]) {
  const spy = vi.spyOn(globalThis, "fetch");
  for (const b of bodies) {
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify(b), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }
  return spy;
}

describe("GET /markPrice", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("returns coin name + mid for a valid asset", async () => {
    mockInfo(
      { universe: [{ name: "BTC" }, { name: "ETH" }] },
      { BTC: "70123.5", ETH: "2400.0" },
    );
    const res = await app.inject({ method: "GET", url: "/markPrice?asset=0" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ asset: 0, coin: "BTC", mid: "70123.5" });
  });

  it("rejects an out-of-range asset", async () => {
    mockInfo({ universe: [{ name: "BTC" }] }, { BTC: "70000" });
    const res = await app.inject({ method: "GET", url: "/markPrice?asset=99" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("INVALID_PARAMS");
  });

  it("rejects when allMids has no entry for the coin", async () => {
    mockInfo({ universe: [{ name: "BTC" }] }, { ETH: "2400" });
    const res = await app.inject({ method: "GET", url: "/markPrice?asset=0" });
    expect(res.statusCode).toBe(422);
  });
});
