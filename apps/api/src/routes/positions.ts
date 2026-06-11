import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

import type { PerpPosition, PositionsResponse } from "@alchemy-hl/shared";

import { ApiException } from "../errors.js";
import { HlClient } from "../helpers/hlClient.js";
import { ApprovalQuerySchema } from "../schemas.js";

/**
 * GET /positions?user=0x... — open perp positions with per-position PnL.
 *
 * Same upstream call as /balance (clearinghouseState) but exposes the
 * assetPositions detail that /balance collapses to a count. Split into its
 * own endpoint so balance polling stays cheap and position views can poll
 * on their own cadence.
 */
export async function positionsRoute(app: FastifyInstance): Promise<void> {
  const hl = new HlClient({
    baseUrl: app.config.HYPERLIQUID_API_URL,
    logger: { warn: app.log.warn.bind(app.log) },
  });

  app.get("/positions", async (req, reply) => {
    let q;
    try {
      q = ApprovalQuerySchema.parse(req.query);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ApiException(
          "INVALID_PARAMS",
          "Bad query: provide ?user=0x...",
          "Pass the wallet whose open positions you want to read.",
        );
      }
      throw err;
    }

    const raw = await hl.info<HlClearinghouseState>({
      type: "clearinghouseState",
      user: q.user,
    });

    const positions: PerpPosition[] = (raw?.assetPositions ?? [])
      .map((ap) => ap?.position)
      .filter((p): p is HlPosition => !!p?.coin && p?.szi !== undefined)
      .map((p) => {
        const szi = Number(p.szi);
        // szi === 0 shouldn't appear in assetPositions, but HL has returned
        // dust entries before — drop anything that rounds to no position.
        if (!Number.isFinite(szi) || szi === 0) return null;
        return {
          coin: p.coin,
          size: String(Math.abs(szi)),
          side: szi > 0 ? ("long" as const) : ("short" as const),
          entryPx: String(p.entryPx ?? "0"),
          positionValue: String(p.positionValue ?? "0"),
          unrealizedPnl: String(p.unrealizedPnl ?? "0"),
          returnOnEquity: String(p.returnOnEquity ?? "0"),
          liquidationPx: p.liquidationPx != null ? String(p.liquidationPx) : null,
          leverage: p.leverage?.value ?? 1,
          leverageMode: p.leverage?.type === "isolated" ? ("isolated" as const) : ("cross" as const),
          marginUsed: String(p.marginUsed ?? "0"),
        };
      })
      .filter((p): p is PerpPosition => p !== null);

    const out: PositionsResponse = { user: q.user, positions };
    return reply.send(out);
  });
}

// ---- HL response shapes (subset) --------------------------------------------

interface HlPosition {
  coin: string;
  szi: string | number;
  entryPx?: string | number;
  positionValue?: string | number;
  unrealizedPnl?: string | number;
  returnOnEquity?: string | number;
  liquidationPx?: string | number | null;
  leverage?: { type?: string; value?: number };
  marginUsed?: string | number;
}

interface HlClearinghouseState {
  assetPositions?: Array<{ position?: HlPosition }>;
}
