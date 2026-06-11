/**
 * Trigger (TP/SL) legs through /exchange — locks in that the action schema
 * accepts HL's trigger order type and the build phase produces a signable
 * envelope with the builder injected. The SDK's takeProfit/stopLoss depend
 * on this shape.
 */

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

describe("trigger orders through /exchange build", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it("accepts a reduce-only TP market trigger leg and injects the builder", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/exchange",
      payload: {
        action: {
          type: "order",
          grouping: "na",
          orders: [
            {
              a: 0,
              b: false,
              p: "108000",
              s: "0.5",
              r: true,
              t: { trigger: { isMarket: true, triggerPx: "120000", tpsl: "tp" } },
            },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const built = res.json() as BuildResponse;
    expect(built.typedData?.domain?.chainId).toBe(1337);
    expect(built.builderFee).toBeGreaterThan(0);
    const leg = (built.action as { orders: Array<{ t: unknown }> }).orders[0]!;
    expect(leg.t).toEqual({ trigger: { isMarket: true, triggerPx: "120000", tpsl: "tp" } });
  });

  it("rejects a malformed trigger leg (bad tpsl value)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/exchange",
      payload: {
        action: {
          type: "order",
          grouping: "na",
          orders: [
            {
              a: 0,
              b: false,
              p: "1",
              s: "1",
              r: true,
              t: { trigger: { isMarket: true, triggerPx: "1", tpsl: "nope" } },
            },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("INVALID_PARAMS");
  });
});
