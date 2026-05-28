/**
 * POST /preflight tests.
 *
 * Pure local validation — no HL roundtrip needed. We exercise:
 *   - happy path (single perp leg) → valid, estimated fee correct
 *   - spot leg → estimatedFee.surface = "spot"
 *   - mixed perps+spot → invalid with a specific error path
 *   - bad shape → invalid with zod errors propagated
 */

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { ApiException, sendError } from "../src/errors.js";
import { preflightRoute } from "../src/routes/preflight.js";

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
  await preflightRoute(app);
  return app;
}

const order = (asset: number) => ({
  type: "order" as const,
  grouping: "na" as const,
  orders: [
    {
      a: asset,
      b: true,
      p: "1000",
      s: "0.001",
      r: false,
      t: { limit: { tif: "Gtc" } },
    },
  ],
});

describe("POST /preflight", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it("happy path on a perp order", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/preflight",
      payload: { action: order(0) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.errors).toEqual([]);
    expect(body.isSpot).toBe(false);
    expect(body.estimatedFee).toEqual({ bps: 4, surface: "perps" });
    expect(body.assetInfo[0]).toMatchObject({ assetIndex: 0, side: "buy", isSpot: false });
  });

  it("reports spot surface on a spot leg", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/preflight",
      payload: { action: order(10001) },
    });
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.estimatedFee).toEqual({ bps: 5, surface: "spot" });
    expect(body.isSpot).toBe(true);
  });

  it("rejects mixed perps+spot legs with a targeted error", async () => {
    const action = order(0);
    action.orders.push({
      a: 10001,
      b: false,
      p: "10",
      s: "1",
      r: false,
      t: { limit: { tif: "Gtc" } },
    });
    const res = await app.inject({
      method: "POST",
      url: "/preflight",
      payload: { action },
    });
    const body = res.json();
    expect(body.valid).toBe(false);
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "orders", message: expect.stringMatching(/Mixed/) }),
      ]),
    );
  });

  it("returns valid:false with zod issues on bad shape", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/preflight",
      payload: { action: { type: "order", grouping: "na", orders: [] } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
  });
});
