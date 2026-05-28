/**
 * POST /openOrders + POST /orderStatus tests.
 *
 * Both are thin info-endpoint proxies with shaping. Coverage focuses on:
 *   - openOrders: cancel actions are pre-built with the right shape per order
 *   - orderStatus: status string is mapped to a human-readable explanation
 *   - bad input → INVALID_PARAMS
 */

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import { ApiException, sendError } from "../src/errors.js";
import { openOrdersRoute } from "../src/routes/openOrders.js";
import { orderStatusRoute } from "../src/routes/orderStatus.js";

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

function mockInfoOnce(body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

const USER = "0xcccc000000000000000000000000000000000001";

describe("POST /openOrders", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp(openOrdersRoute);
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("returns each order with a pre-built cancel action", async () => {
    mockInfoOnce([
      { oid: 123, asset: 0, side: "B", limitPx: "1000", sz: "0.5", origSz: "1", timestamp: 1 },
      { oid: 124, asset: 1, side: "A", limitPx: "2000", sz: "0.1", origSz: "0.1", timestamp: 2 },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/openOrders",
      payload: { user: USER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toBe(USER);
    expect(body.orders).toHaveLength(2);
    expect(body.orders[0]).toMatchObject({
      oid: 123,
      assetIndex: 0,
      side: "buy",
      cancelAction: { type: "cancel", cancels: [{ a: 0, o: 123 }] },
    });
    expect(body.orders[1]).toMatchObject({
      side: "sell",
      cancelAction: { type: "cancel", cancels: [{ a: 1, o: 124 }] },
    });
  });

  it("rejects missing user with INVALID_PARAMS", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/openOrders",
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("INVALID_PARAMS");
  });
});

describe("POST /orderStatus", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp(orderStatusRoute);
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("translates open → explanation", async () => {
    mockInfoOnce({ status: "open" });
    const res = await app.inject({
      method: "POST",
      url: "/orderStatus",
      payload: { user: USER, oid: 99 },
    });
    const body = res.json();
    expect(body.status).toBe("open");
    expect(body.explanation).toMatch(/live on the book/);
  });

  it("translates rejected → actionable explanation", async () => {
    mockInfoOnce({ order: { status: "rejected" } });
    const res = await app.inject({
      method: "POST",
      url: "/orderStatus",
      payload: { user: USER, oid: 99 },
    });
    const body = res.json();
    expect(body.status).toBe("rejected");
    expect(body.explanation).toMatch(/Check size, price tick/);
  });

  it("falls back to a generic message on unknown status", async () => {
    mockInfoOnce({ status: "weirdNewStatus" });
    const res = await app.inject({
      method: "POST",
      url: "/orderStatus",
      payload: { user: USER, oid: 99 },
    });
    const body = res.json();
    expect(body.explanation).toMatch(/unfamiliar status/);
  });

  it("rejects missing oid with INVALID_PARAMS", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/orderStatus",
      payload: { user: USER },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("INVALID_PARAMS");
  });
});
