import type { FastifyInstance } from "fastify";

import { ApiException } from "../errors.js";
import { metrics } from "../helpers/metrics.js";

/**
 * GET /metrics — Prometheus text exposition.
 *
 * Revenue counters are business-sensitive, so when METRICS_TOKEN is set the
 * endpoint requires `Authorization: Bearer <token>`. Unset (local dev) it's
 * open. Production deployments should set it.
 */
export async function metricsRoute(app: FastifyInstance): Promise<void> {
  app.get("/metrics", async (req, reply) => {
    const required = app.config.METRICS_TOKEN;
    if (required) {
      const m = req.headers.authorization?.match(/^Bearer\s+(.+)$/i);
      if (m?.[1] !== required) {
        throw new ApiException(
          "NOT_APPROVED",
          "Missing or wrong metrics token.",
          "Pass `Authorization: Bearer <METRICS_TOKEN>` — the value set on the api service.",
        );
      }
    }
    return reply
      .header("content-type", "text/plain; version=0.0.4; charset=utf-8")
      .send(metrics.expose());
  });
}
