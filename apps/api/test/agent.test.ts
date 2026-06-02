/**
 * Tests for the agent key derivation helper + GET /agent endpoint + the
 * approveAgent build path on /exchange.
 *
 * Coverage:
 *   - deriveAgentAddress is deterministic for (seed, user)
 *   - Different users derive different agent addresses for same seed
 *   - Different seeds derive different agent addresses for same user
 *   - GET /agent returns the right address
 *   - /agent rejects when seed isn't configured
 *   - /exchange build for approveAgent fills agentAddress from derivation
 *   - /exchange build for approveAgent with explicit zero-address (revoke) survives
 *   - /exchange build for approveAgent without `user` field rejects
 */

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { ApiException, sendError } from "../src/errors.js";
import { deriveAgentAddress, deriveAgentKey } from "../src/helpers/agent.js";
import { agentRoute } from "../src/routes/agent.js";
import { exchangeRoute } from "../src/routes/exchange.js";

const SEED = "0x1111111111111111111111111111111111111111111111111111111111111111";
const SEED_2 = "0x2222222222222222222222222222222222222222222222222222222222222222";
const USER_A = "0xaaaa000000000000000000000000000000000001";
const USER_B = "0xbbbb000000000000000000000000000000000001";

const baseEnv = {
  ALCHEMY_BUILDER_ADDRESS: "0xAAAA000000000000000000000000000000000001",
  HYPERLIQUID_API_URL: "https://api.hyperliquid-testnet.xyz",
  PERPS_BUILDER_FEE_BPS: "4",
  SPOT_BUILDER_FEE_BPS: "5",
  AGENT_MASTER_SEED: SEED,
} as unknown as NodeJS.ProcessEnv;

async function buildApp(
  registers: ((a: FastifyInstance) => Promise<void>)[],
  envOverride: NodeJS.ProcessEnv = baseEnv,
): Promise<FastifyInstance> {
  const cfg = loadConfig(envOverride);
  const app = Fastify({ logger: false });
  app.decorate("config", cfg);
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiException) return sendError(reply, err);
    return reply.code(500).send({ error: "INTERNAL_ERROR", message: String(err) });
  });
  for (const r of registers) await r(app);
  return app;
}

describe("agent key derivation", () => {
  it("is deterministic for the same (seed, user)", () => {
    const a = deriveAgentKey(SEED, USER_A);
    const b = deriveAgentKey(SEED, USER_A);
    expect(a).toBe(b);
  });

  it("different users → different agent addresses", () => {
    const a = deriveAgentAddress(SEED, USER_A);
    const b = deriveAgentAddress(SEED, USER_B);
    expect(a).not.toBe(b);
  });

  it("different seeds → different agent addresses for same user", () => {
    const a = deriveAgentAddress(SEED, USER_A);
    const b = deriveAgentAddress(SEED_2, USER_A);
    expect(a).not.toBe(b);
  });

  it("rejects a malformed master seed", () => {
    expect(() => deriveAgentKey("0xabc" as `0x${string}`, USER_A)).toThrow(/32 bytes/);
  });
});

describe("GET /agent", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp([agentRoute]);
  });
  afterEach(async () => {
    await app.close();
  });

  it("returns user → agent address mapping", async () => {
    const res = await app.inject({ method: "GET", url: `/agent?user=${USER_A}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toBe(USER_A);
    expect(body.agentAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(body.agentName).toBe("Alchemy");
    // Same call again returns the same agent address (deterministic).
    const res2 = await app.inject({ method: "GET", url: `/agent?user=${USER_A}` });
    expect(res2.json().agentAddress).toBe(body.agentAddress);
  });

  it("rejects malformed user", async () => {
    const res = await app.inject({ method: "GET", url: "/agent?user=foo" });
    expect(res.statusCode).toBe(422);
  });

  it("rejects when AGENT_MASTER_SEED is not configured", async () => {
    const noSeedEnv = { ...baseEnv };
    delete noSeedEnv.AGENT_MASTER_SEED;
    const noSeedApp = await buildApp([agentRoute], noSeedEnv);
    try {
      const res = await noSeedApp.inject({ method: "GET", url: `/agent?user=${USER_A}` });
      expect(res.statusCode).toBe(422);
      expect(res.json().message).toMatch(/AGENT_MASTER_SEED/);
    } finally {
      await noSeedApp.close();
    }
  });
});

describe("/exchange build for approveAgent", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp([exchangeRoute]);
  });
  afterEach(async () => {
    await app.close();
  });

  it("derives agentAddress from user when not provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/exchange",
      payload: { action: { type: "approveAgent" }, user: USER_A },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.action.type).toBe("approveAgent");
    expect(body.action.agentAddress).toBe(deriveAgentAddress(SEED, USER_A));
    expect(body.action.agentName).toBe("Alchemy");
    expect(body.typedData.primaryType).toBe("HyperliquidTransaction:ApproveAgent");
  });

  it("accepts an explicit agentAddress (e.g. zero for revoke)", async () => {
    const zero = "0x0000000000000000000000000000000000000000";
    const res = await app.inject({
      method: "POST",
      url: "/exchange",
      payload: {
        action: { type: "approveAgent", agentAddress: zero },
        user: USER_A,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().action.agentAddress).toBe(zero);
  });

  it("rejects when user is missing and agentAddress isn't provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/exchange",
      payload: { action: { type: "approveAgent" } },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toMatch(/user/i);
  });

  it("rejects when AGENT_MASTER_SEED isn't configured", async () => {
    const noSeedEnv = { ...baseEnv };
    delete noSeedEnv.AGENT_MASTER_SEED;
    const noSeedApp = await buildApp([exchangeRoute], noSeedEnv);
    try {
      const res = await noSeedApp.inject({
        method: "POST",
        url: "/exchange",
        payload: { action: { type: "approveAgent" }, user: USER_A },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().message).toMatch(/AGENT_MASTER_SEED/);
    } finally {
      await noSeedApp.close();
    }
  });
});
