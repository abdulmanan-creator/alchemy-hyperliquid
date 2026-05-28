import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

import type { CancelAction } from "@alchemy-hl/shared";

import { ApiException } from "../errors.js";
import { HlClient } from "../helpers/hlClient.js";
import { UserBodySchema } from "../schemas.js";

/**
 * POST /openOrders { user } → enriched open orders.
 *
 * Each order in the response is paired with a `cancelAction` already built
 * with the right shape ({ type: "cancel", cancels: [{ a, o }] }) — the
 * client just needs to sign it and post back to /exchange.
 *
 * Why server-build the cancel action: clients shouldn't have to know HL's
 * action wire shape. We already do that work for the order placement flow;
 * doing it for cancel keeps the API ergonomic.
 */
export async function openOrdersRoute(app: FastifyInstance): Promise<void> {
  const hl = new HlClient({
    baseUrl: app.config.HYPERLIQUID_API_URL,
    logger: { warn: app.log.warn.bind(app.log) },
  });

  app.post("/openOrders", async (req, reply) => {
    let body;
    try {
      body = UserBodySchema.parse(req.body);
    } catch (err) {
      throw zodToApi(err);
    }

    const raw = await hl.info<HlOpenOrder[]>({
      type: "openOrders",
      user: body.user,
    });

    const orders = (raw ?? []).map((o) => {
      const cancelAction: CancelAction = {
        type: "cancel",
        cancels: [{ a: o.asset ?? 0, o: o.oid }],
      };
      return {
        oid: o.oid,
        assetIndex: o.asset ?? 0,
        side: o.side === "B" ? "buy" : "sell",
        limitPx: o.limitPx,
        sz: o.sz,
        origSz: o.origSz,
        timestamp: o.timestamp,
        cancelAction,
      };
    });

    return reply.send({ user: body.user, orders });
  });
}

function zodToApi(err: unknown): ApiException {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return new ApiException(
      "INVALID_PARAMS",
      `Bad body at ${first?.path.join(".") ?? "(root)"}: ${first?.message ?? "validation failed"}`,
      "Send { \"user\": \"0x...\" }.",
    );
  }
  return new ApiException(
    "INVALID_JSON",
    "Could not parse the request body.",
    "Send a JSON object with a `user` field.",
  );
}

interface HlOpenOrder {
  oid: number;
  asset?: number;
  side?: "B" | "A";
  limitPx?: string;
  sz?: string;
  origSz?: string;
  timestamp?: number;
}
