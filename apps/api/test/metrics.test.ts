/**
 * Metrics: fee-revenue accounting math + /metrics endpoint auth.
 *
 * The metrics registry is a process-global singleton, so tests assert
 * deltas (parse-before vs parse-after) rather than absolute values.
 */

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { ApiException, sendError } from "../src/errors.js";
import { metrics, recordOrderOutcome } from "../src/helpers/metrics.js";
import { metricsRoute } from "../src/routes/metrics.js";

/** Pull a single metric value (summed across label sets) out of exposition text. */
function metricTotal(exposition: string, name: string): number {
  let total = 0;
  for (const line of exposition.split("\n")) {
    if (line.startsWith("#") || !line.startsWith(name)) continue;
    const value = Number(line.split(" ").pop());
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

describe("recordOrderOutcome", () => {
  it("computes fee from filled notional × wire fee (tenths of bps)", () => {
    const before = metricTotal(metrics.expose(), "alchemy_builder_fee_usd_total");
    // 0.1 @ $100 = $10 notional. f=40 (4 bps) → fee $10 * 40/1e5 = $0.004
    recordOrderOutcome(
      {
        status: "ok",
        response: { type: "order", data: { statuses: [{ filled: { totalSz: "0.1", avgPx: "100" } }] } },
      },
      40,
      "user",
    );
    const after = metricTotal(metrics.expose(), "alchemy_builder_fee_usd_total");
    expect(after - before).toBeCloseTo(0.004, 9);
  });

  it("ignores resting/error statuses and err responses", () => {
    const before = metricTotal(metrics.expose(), "alchemy_filled_notional_usd_total");
    recordOrderOutcome(
      { status: "ok", response: { type: "order", data: { statuses: [{ resting: { oid: 1 } }] } } },
      40,
      "user",
    );
    recordOrderOutcome({ status: "err", response: "nope" }, 40, "user");
    const after = metricTotal(metrics.expose(), "alchemy_filled_notional_usd_total");
    expect(after - before).toBe(0);
  });
});

describe("GET /metrics", () => {
  const baseEnv = {
    ALCHEMY_BUILDER_ADDRESS: "0xAAAA000000000000000000000000000000000001",
    HYPERLIQUID_API_URL: "https://api.hyperliquid-testnet.xyz",
    PERPS_BUILDER_FEE_BPS: "4",
    SPOT_BUILDER_FEE_BPS: "5",
  } as unknown as NodeJS.ProcessEnv;

  let app: FastifyInstance;
  afterEach(async () => {
    await app.close();
  });

  async function buildApp(env: NodeJS.ProcessEnv): Promise<FastifyInstance> {
    const cfg = loadConfig(env);
    const instance = Fastify({ logger: false });
    instance.decorate("config", cfg);
    instance.setErrorHandler((err, _req, reply) => {
      if (err instanceof ApiException) return sendError(reply, err);
      return reply.code(500).send({ error: "INTERNAL_ERROR", message: String(err) });
    });
    await metricsRoute(instance);
    return instance;
  }

  it("serves Prometheus text without a token when METRICS_TOKEN is unset", async () => {
    app = await buildApp(baseEnv);
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain("alchemy_builder_fee_usd_total");
    expect(res.body).toContain("# TYPE alchemy_http_requests_total counter");
  });

  it("requires the bearer token when METRICS_TOKEN is set", async () => {
    const token = "super-secret-metrics-token";
    app = await buildApp({ ...baseEnv, METRICS_TOKEN: token } as NodeJS.ProcessEnv);

    const noAuth = await app.inject({ method: "GET", url: "/metrics" });
    expect(noAuth.statusCode).toBe(403);

    const wrong = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer nope-nope-nope-nope" },
    });
    expect(wrong.statusCode).toBe(403);

    const right = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(right.statusCode).toBe(200);
  });
});
