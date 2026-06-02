import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { ApiException } from "../errors.js";
import { AGENT_NAME, deriveAgentAddress } from "../helpers/agent.js";
import { ApprovalQuerySchema } from "../schemas.js";

/**
 * GET /agent?user=0x... → { user, agentAddress, agentName }
 *
 * Returns the deterministic agent wallet address for `user` (derived from
 * AGENT_MASTER_SEED + user). Used by the connector setup UI to show the user
 * which address they're delegating to before they sign approveAgent.
 *
 * Does NOT reveal the agent's private key — that's server-side only.
 *
 * Returns INVALID_PARAMS (with a configuration-style guidance) when
 * AGENT_MASTER_SEED isn't set; that lets the UI gate the unattended-trading
 * flow on environments where this hasn't been provisioned yet.
 */
export async function agentRoute(app: FastifyInstance): Promise<void> {
  app.get("/agent", async (req, reply) => {
    let q;
    try {
      q = ApprovalQuerySchema.parse(req.query);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ApiException(
          "INVALID_PARAMS",
          "Bad query: provide ?user=0x...",
          "Pass the wallet you intend to delegate trading authority from.",
        );
      }
      throw err;
    }

    if (!app.config.AGENT_MASTER_SEED) {
      throw new ApiException(
        "INVALID_PARAMS",
        "AGENT_MASTER_SEED is not configured on this deployment.",
        "Server hasn't enabled unattended trading. Set AGENT_MASTER_SEED (32-byte hex) in env and restart.",
      );
    }

    const agentAddress = deriveAgentAddress(
      app.config.AGENT_MASTER_SEED as `0x${string}`,
      q.user,
    );

    return reply.send({
      user: q.user,
      agentAddress,
      agentName: AGENT_NAME,
    });
  });
}
