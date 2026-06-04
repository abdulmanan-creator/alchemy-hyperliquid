import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";

import type { UserFill, UserFillsResponse } from "@alchemy-hl/shared";

import { ApiException } from "../errors.js";
import { HlClient } from "../helpers/hlClient.js";

/**
 * GET /userFills?user=0x...&limit=50 — recent fills for a wallet.
 *
 * Wraps HL's `userFills` info type. HL returns up to 2000 fills sorted
 * newest-first; we truncate to `limit` (default 50) before returning.
 *
 * Used by the dashboard's "Your activity" panel and (later) the audit log
 * feature for builder-fees-paid-by-this-user analytics.
 */
export async function userFillsRoute(app: FastifyInstance): Promise<void> {
  const hl = new HlClient({
    baseUrl: app.config.HYPERLIQUID_API_URL,
    logger: { warn: app.log.warn.bind(app.log) },
  });

  app.get("/userFills", async (req, reply) => {
    let q;
    try {
      q = z
        .object({
          user: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
          limit: z.coerce.number().int().min(1).max(500).default(50),
        })
        .parse(req.query);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ApiException(
          "INVALID_PARAMS",
          "Bad query: provide ?user=0x... (and optionally &limit=N).",
          "user must be a 0x-prefixed 20-byte address.",
        );
      }
      throw err;
    }

    const fills = (await hl.info<UserFill[]>({
      type: "userFills",
      user: q.user.toLowerCase(),
    })) ?? [];

    const out: UserFillsResponse = {
      user: q.user as `0x${string}`,
      fills: fills.slice(0, q.limit),
    };
    return reply.send(out);
  });
}
