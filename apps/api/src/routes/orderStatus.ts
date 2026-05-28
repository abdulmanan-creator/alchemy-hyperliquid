import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { ApiException } from "../errors.js";
import { HlClient } from "../helpers/hlClient.js";
import { OrderStatusBodySchema } from "../schemas.js";

/**
 * POST /orderStatus { user, oid } → HL's status + a plain-English explanation.
 *
 * Hyperliquid's status field is one of:
 *   open, filled, canceled, triggered, rejected, marginCanceled, vaultWithdrawalCanceled
 *
 * We pass through the raw status + add an `explanation` string the UI can
 * surface verbatim without writing its own copy.
 */
export async function orderStatusRoute(app: FastifyInstance): Promise<void> {
  const hl = new HlClient({
    baseUrl: app.config.HYPERLIQUID_API_URL,
    logger: { warn: app.log.warn.bind(app.log) },
  });

  app.post("/orderStatus", async (req, reply) => {
    let body;
    try {
      body = OrderStatusBodySchema.parse(req.body);
    } catch (err) {
      throw zodToApi(err);
    }

    const raw = await hl.info<HlOrderStatus>({
      type: "orderStatus",
      user: body.user,
      oid: body.oid,
    });

    const status = raw?.order?.status ?? raw?.status ?? "unknown";
    return reply.send({
      user: body.user,
      oid: body.oid,
      status,
      explanation: explain(status),
      raw,
    });
  });
}

function explain(status: string): string {
  switch (status) {
    case "open":
      return "Order is live on the book.";
    case "filled":
      return "Order filled completely.";
    case "partiallyFilled":
    case "partialFilled":
      return "Order partially filled; the remainder is still resting.";
    case "canceled":
      return "Order was canceled (by you or by the system).";
    case "triggered":
      return "Trigger order fired and entered the book.";
    case "rejected":
      return "Order was rejected at submission. Check size, price tick, and margin.";
    case "marginCanceled":
      return "Order canceled because the account fell below the margin requirement.";
    case "vaultWithdrawalCanceled":
      return "Order canceled because the funding vault withdrew the backing margin.";
    default:
      return `Hyperliquid returned an unfamiliar status: "${status}". Inspect the raw field for details.`;
  }
}

function zodToApi(err: unknown): ApiException {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return new ApiException(
      "INVALID_PARAMS",
      `Bad body at ${first?.path.join(".") ?? "(root)"}: ${first?.message ?? "validation failed"}`,
      "Send { \"user\": \"0x...\", \"oid\": 12345 }.",
    );
  }
  return new ApiException(
    "INVALID_JSON",
    "Could not parse the request body.",
    "Send a JSON object with `user` and `oid` fields.",
  );
}

interface HlOrderStatus {
  status?: string;
  order?: { status?: string };
}
