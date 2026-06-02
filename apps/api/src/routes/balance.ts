import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

import type { BalanceState } from "@alchemy-hl/shared";

import { ApiException } from "../errors.js";
import { HlClient } from "../helpers/hlClient.js";
import { ApprovalQuerySchema } from "../schemas.js";

/**
 * GET /balance?user=0x... — proxies HL's clearinghouseState (perp account).
 *
 * Used by the TestTradeCard to show "builder earned $X" before-and-after a
 * trade. Also load-bearing for any future "builder revenue dashboard" surface.
 *
 * HL's `clearinghouseState` returns a fairly large object; we collapse it to
 * the fields the UI actually wants. If callers need the raw view they can hit
 * HL's info endpoint directly through their own clients.
 */
export async function balanceRoute(app: FastifyInstance): Promise<void> {
  const hl = new HlClient({
    baseUrl: app.config.HYPERLIQUID_API_URL,
    logger: { warn: app.log.warn.bind(app.log) },
  });

  app.get("/balance", async (req, reply) => {
    let q;
    try {
      q = ApprovalQuerySchema.parse(req.query);
    } catch (err) {
      if (err instanceof ZodError) {
        const first = err.issues[0];
        throw new ApiException(
          "INVALID_PARAMS",
          `Bad query: ${first?.path.join(".") ?? "(root)"}: ${first?.message ?? "validation failed"}`,
          "Provide ?user=0x... (the wallet whose HL perp balance you want to read).",
        );
      }
      throw err;
    }

    const raw = await hl.info<HlClearinghouseState>({
      type: "clearinghouseState",
      user: q.user,
    });

    const summary = raw?.marginSummary ?? {};
    const out: BalanceState = {
      user: q.user,
      accountValue: String(summary.accountValue ?? "0"),
      withdrawable: String(raw?.withdrawable ?? "0"),
      marginUsed: String(summary.totalMarginUsed ?? "0"),
      openPositions: Array.isArray(raw?.assetPositions) ? raw.assetPositions.length : 0,
    };

    return reply.send(out);
  });
}

interface HlClearinghouseState {
  marginSummary?: {
    accountValue?: string | number;
    totalMarginUsed?: string | number;
  };
  withdrawable?: string | number;
  assetPositions?: unknown[];
}
