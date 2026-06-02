/**
 * GET /balance tests.
 *
 * Coverage:
 *   - Happy path: HL returns a clearinghouseState → we collapse it correctly.
 *   - Empty account → all-zero balance.
 *   - Bad query → INVALID_PARAMS.
 */

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BalanceState } from "@alchemy-hl/shared";

import { loadConfig } from "../src/config.js";
import { ApiException, sendError } from "../src/errors.js";
import { balanceRoute } from "../src/routes/balance.js";

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
  await balanceRoute(app);
  return app;
}

function mockInfo(body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

const USER = "0xcccc000000000000000000000000000000000001";

describe("GET /balance", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("collapses a populated clearinghouseState into our envelope", async () => {
    mockInfo({
      marginSummary: { accountValue: "100.50", totalMarginUsed: "20.00" },
      withdrawable: "80.50",
      assetPositions: [{ position: { coin: "BTC" } }],
    });
    const res = await app.inject({ method: "GET", url: `/balance?user=${USER}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BalanceState;
    expect(body.user).toBe(USER);
    expect(body.accountValue).toBe("100.50");
    expect(body.withdrawable).toBe("80.50");
    expect(body.marginUsed).toBe("20.00");
    expect(body.openPositions).toBe(1);
  });

  it("returns all zeros for an empty account", async () => {
    mockInfo({});
    const res = await app.inject({ method: "GET", url: `/balance?user=${USER}` });
    const body = res.json() as BalanceState;
    expect(body.accountValue).toBe("0");
    expect(body.withdrawable).toBe("0");
    expect(body.marginUsed).toBe("0");
    expect(body.openPositions).toBe(0);
  });

  it("rejects missing user with INVALID_PARAMS", async () => {
    const res = await app.inject({ method: "GET", url: "/balance" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("INVALID_PARAMS");
  });
});
