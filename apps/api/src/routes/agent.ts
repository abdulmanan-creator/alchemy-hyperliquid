import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { privateKeyToAccount } from "viem/accounts";

import type { Action, SendResponse } from "@alchemy-hl/shared";

import { ApiException } from "../errors.js";
import { injectBuilder } from "../helpers/builder.js";
import {
  AGENT_NAME,
  deriveAgentAddress,
  deriveAgentKey,
} from "../helpers/agent.js";
import { phantomAgentTypedData } from "../helpers/hash.js";
import { HlClient } from "../helpers/hlClient.js";
import { verifyPrivyAuth } from "../helpers/privyAuth.js";
import { ActionSchema, ApprovalQuerySchema } from "../schemas.js";

/**
 * GET /agent?user=0x... → { user, agentAddress, agentName }
 * POST /agent/exchange     → server-side agent-signing (Privy JWT auth)
 *
 * GET is unauthenticated — anyone can look up a user's deterministic agent
 * address (it's not secret, just derivation-bound).
 *
 * POST is the unattended-trading entrypoint: authenticated by a Privy JWT,
 * server signs the action with the user's per-user agent key and forwards
 * to HL. The user must have signed approveAgent for that agent address
 * separately (typically once during /connect/* setup). Without that
 * approval, HL rejects the trade — passes through as HL_EXCHANGE_REJECTED.
 *
 * Action types accepted on /agent/exchange:
 *   - order, cancel, cancelByCloid  ← agent-signable L1 actions
 *
 * Refused on /agent/exchange:
 *   - approveBuilderFee, approveAgent  ← must come from the user's main key
 *     since they require user authorization (the user can't delegate the
 *     act of delegating).
 */
export async function agentRoute(app: FastifyInstance): Promise<void> {
  const hl = new HlClient({
    baseUrl: app.config.HYPERLIQUID_API_URL,
    logger: { warn: app.log.warn.bind(app.log) },
  });

  // -------------------------------------------------------------------------
  // GET /agent — public lookup of a user's derived agent address.
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // POST /agent/exchange — authenticated agent-signing.
  // -------------------------------------------------------------------------
  app.post("/agent/exchange", async (req, reply) => {
    // 1. Verify Privy JWT, resolve to the user's wallet address.
    const auth = await verifyPrivyAuth(req.headers.authorization, app.config);

    if (!app.config.AGENT_MASTER_SEED) {
      throw new ApiException(
        "INVALID_PARAMS",
        "AGENT_MASTER_SEED is not configured.",
        "Server hasn't enabled unattended trading. Set AGENT_MASTER_SEED in env and restart.",
      );
    }

    // 2. Validate body shape.
    let action: Action;
    try {
      const body = req.body as { action: unknown };
      if (!body?.action) {
        throw new ApiException(
          "INVALID_PARAMS",
          "Body must include `action`.",
          "POST { \"action\": {...} } — same action shape as POST /exchange.",
        );
      }
      action = ActionSchema.parse(body.action);
    } catch (err) {
      if (err instanceof ZodError) {
        const first = err.issues[0];
        throw new ApiException(
          "INVALID_PARAMS",
          `Bad action at ${first?.path.join(".") ?? "(root)"}: ${first?.message ?? "validation failed"}`,
          "See the action schema in @alchemy-hl/shared.",
        );
      }
      throw err;
    }

    // 3. Reject action types that must come from the user's main key.
    if (action.type === "approveBuilderFee" || action.type === "approveAgent") {
      throw new ApiException(
        "INVALID_PARAMS",
        `Action "${action.type}" cannot be agent-signed — it requires the user's primary wallet signature.`,
        "Use POST /exchange (the normal user-signed path) for approveBuilderFee and approveAgent. /agent/exchange is for routine trading actions only.",
      );
    }

    // 4. Builder injection for order actions (same as the regular /exchange path).
    if (action.type === "order") {
      injectBuilder(action, app.config);
    }

    // 5. Derive the user's agent key, build the L1 phantom-agent envelope,
    //    sign locally with the agent.
    const agentKey = deriveAgentKey(
      app.config.AGENT_MASTER_SEED as `0x${string}`,
      auth.walletAddress,
    );
    const agentAccount = privateKeyToAccount(agentKey);
    const nonce = Date.now();
    const { typedData } = phantomAgentTypedData(action, nonce, {
      isTestnet: app.config.isTestnet,
    });
    const sigHex = await agentAccount.signTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });
    const signature = splitHexSig(sigHex);

    req.log.info(
      {
        type: action.type,
        user: auth.walletAddress,
        agent: agentAccount.address,
        nonce,
      },
      "agent_send",
    );

    // 6. Forward to HL. HL recovers the agent's address from the sig, looks
    //    up the user via approveAgent records, processes the trade as
    //    coming from the user.
    const exchangeResponse = await hl.forwardExchange({
      action: action as unknown,
      nonce,
      signature,
    });

    const out: SendResponse = {
      success: true,
      user: auth.walletAddress,
      exchangeResponse,
    };
    return reply.send(out);
  });
}

/**
 * Split a 65-byte hex signature into {r, s, v}, normalizing v to 27/28.
 * Same shape as the user-side helper; duplicated here to keep this file
 * self-contained.
 */
function splitHexSig(hex: `0x${string}`): {
  r: `0x${string}`;
  s: `0x${string}`;
  v: number;
} {
  const stripped = hex.replace(/^0x/, "");
  if (stripped.length !== 130) {
    throw new Error(`Unexpected sig length: ${stripped.length}`);
  }
  let v = parseInt(stripped.slice(128, 130), 16);
  if (v < 27) v += 27;
  return {
    r: `0x${stripped.slice(0, 64)}` as `0x${string}`,
    s: `0x${stripped.slice(64, 128)}` as `0x${string}`,
    v,
  };
}
