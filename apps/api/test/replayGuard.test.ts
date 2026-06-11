/**
 * /exchange Phase B replay protection.
 *
 *   - Resubmitting the same signed payload → 409 DUPLICATE_REQUEST, and the
 *     duplicate never reaches Hyperliquid.
 *   - If the first attempt died with HL unreachable, the same payload may be
 *     retried (the guard only protects payloads that actually reached HL).
 */

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

import type { BuildResponse } from "@alchemy-hl/shared";

import { loadConfig } from "../src/config.js";
import { ApiException, sendError } from "../src/errors.js";
import { exchangeRoute } from "../src/routes/exchange.js";

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
  await exchangeRoute(app);
  return app;
}

const ORDER = {
  type: "order",
  grouping: "na",
  orders: [{ a: 0, b: true, p: "1000", s: "0.001", r: false, t: { limit: { tif: "Gtc" } } }],
};

function splitHexSig(hex: `0x${string}`) {
  const s = hex.replace(/^0x/, "");
  let v = parseInt(s.slice(128, 130), 16);
  if (v < 27) v += 27;
  return {
    r: `0x${s.slice(0, 64)}` as `0x${string}`,
    s: `0x${s.slice(64, 128)}` as `0x${string}`,
    v,
  };
}

/** Build + sign one order, returning the Phase B payload. */
async function signedPayload(app: FastifyInstance) {
  const account = privateKeyToAccount(generatePrivateKey());
  const buildRes = await app.inject({ method: "POST", url: "/exchange", payload: { action: ORDER } });
  const built = buildRes.json() as BuildResponse;
  if (!built.typedData) throw new Error("missing typedData");
  const sigHex = await account.signTypedData({
    domain: built.typedData.domain,
    types: built.typedData.types,
    primaryType: built.typedData.primaryType,
    message: built.typedData.message,
  });
  return { action: built.action, nonce: built.nonce, signature: splitHexSig(sigHex) };
}

const HL_OK = () =>
  new Response(JSON.stringify({ status: "ok", response: { type: "order" } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("replay guard", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("rejects the second submission of the same signed payload with 409", async () => {
    const payload = await signedPayload(app);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(HL_OK());

    const first = await app.inject({ method: "POST", url: "/exchange", payload });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: "POST", url: "/exchange", payload });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("DUPLICATE_REQUEST");

    // The duplicate must not have been forwarded to HL.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("allows retrying the same payload after HL was unreachable", async () => {
    const payload = await signedPayload(app);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(HL_OK());

    const first = await app.inject({ method: "POST", url: "/exchange", payload });
    expect(first.statusCode).toBe(502);
    expect(first.json().error).toBe("HL_EXCHANGE_UNREACHABLE");

    const retry = await app.inject({ method: "POST", url: "/exchange", payload });
    expect(retry.statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps the guard when HL rejected the action (it did reach HL)", async () => {
    const payload = await signedPayload(app);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "err", response: "Insufficient margin" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const first = await app.inject({ method: "POST", url: "/exchange", payload });
    expect(first.statusCode).toBe(422);

    const second = await app.inject({ method: "POST", url: "/exchange", payload });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("DUPLICATE_REQUEST");
  });
});
