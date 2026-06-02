import type { FastifyInstance } from "fastify";
import { hashTypedData } from "viem";
import { ZodError } from "zod";

import type {
  Action,
  BuildResponse,
  SendResponse,
} from "@alchemy-hl/shared";

import { ApiException } from "../errors.js";
import { ExchangeBodySchema, type ExchangeBody } from "../schemas.js";
import { injectBuilder, orderHasSpot, feeBpsFor } from "../helpers/builder.js";
import { phantomAgentTypedData } from "../helpers/hash.js";
import { buildApproveBuilderFeeTypedData } from "../helpers/eip712.js";
import { recoverActionSigner } from "../helpers/verify.js";
import { HlClient } from "../helpers/hlClient.js";

/**
 * POST /exchange — single dispatch endpoint.
 *
 * Phase A (Build):
 *   body = { action }
 *   → server validates + injects builder + returns hash/nonce/typedData
 *
 * Phase B (Send):
 *   body = { action, nonce, signature }
 *   → server re-injects builder, re-derives the EIP-712 envelope, recovers
 *     the signer, re-checks builder + cap, forwards the signed payload.
 *
 * The phase is determined by presence of `signature`. Missing nonce in Phase A
 * is filled with Date.now(); missing nonce in Phase B is INVALID_PARAMS.
 */
export async function exchangeRoute(app: FastifyInstance): Promise<void> {
  const hl = new HlClient({
    baseUrl: app.config.HYPERLIQUID_API_URL,
    logger: { warn: app.log.warn.bind(app.log) },
  });

  app.post("/exchange", async (req, reply) => {
    let body: ExchangeBody;
    try {
      body = ExchangeBodySchema.parse(req.body);
    } catch (err) {
      throw zodToApi(err);
    }

    if (body.signature) {
      // ---- Phase B: send -----------------------------------------------------
      if (body.nonce === undefined) {
        throw new ApiException(
          "INVALID_PARAMS",
          "Phase B requires `nonce` (the one returned by Phase A).",
          "Echo back the nonce you got from the build response alongside the signature.",
        );
      }

      // Re-inject builder for order actions. This protects against a client
      // that built locally with one fee then tried to send a different one.
      let builderFee: number | undefined;
      if (body.action.type === "order") {
        injectBuilder(body.action, app.config);
        builderFee = body.action.builder?.f;
      }

      const signer = await recoverActionSigner(
        body.action,
        body.nonce,
        body.signature,
        app.config,
      );

      req.log.info(
        { type: body.action.type, signer, builderFee, nonce: body.nonce },
        "exchange_send",
      );

      const exchangeResponse = await hl.forwardExchange({
        action: body.action as unknown,
        nonce: body.nonce,
        signature: body.signature,
      });

      const out: SendResponse = {
        success: true,
        user: signer,
        exchangeResponse,
      };
      return reply.send(out);
    }

    // ---- Phase A: build ------------------------------------------------------
    const nonce = body.nonce ?? Date.now();
    const out = buildPhase(body.action, nonce, app.config);
    req.log.info(
      { type: body.action.type, nonce, hash: out.hash, builderFee: out.builderFee },
      "exchange_build",
    );
    return reply.send(out);
  });
}

/**
 * Refuse to build sign-able payloads when the configured builder is the zero
 * address — almost always means ALCHEMY_BUILDER_ADDRESS wasn't set in .env
 * before the API was started. Without this guard the user could approve the
 * zero address as their builder (harmless but wasted), or place orders that
 * inject builder=0x0 (fees burn). Better to fail loudly here.
 *
 * cancel / cancelByCloid don't reference the builder address so they pass.
 */
const ZERO_ADDR = /^0x0+$/i;

function buildPhase(
  action: Action,
  nonce: number,
  cfg: import("../config.js").Config,
): BuildResponse {
  if (
    (action.type === "order" || action.type === "approveBuilderFee") &&
    ZERO_ADDR.test(cfg.ALCHEMY_BUILDER_ADDRESS)
  ) {
    throw new ApiException(
      "INVALID_PARAMS",
      "Server's ALCHEMY_BUILDER_ADDRESS is the zero address.",
      "Set ALCHEMY_BUILDER_ADDRESS in .env to a real wallet, then fully restart the API (dotenv only reads .env at boot). Until then this endpoint refuses to build payloads that would commit to the zero address.",
    );
  }

  if (action.type === "order") {
    injectBuilder(action, cfg);
    const { hash, typedData } = phantomAgentTypedData(action, nonce, {
      isTestnet: cfg.isTestnet,
    });
    return {
      hash,
      nonce,
      action,
      isSpot: orderHasSpot(action),
      builderFee: feeBpsFor(action, cfg),
      builder: cfg.ALCHEMY_BUILDER_ADDRESS,
      typedData,
    };
  }

  if (action.type === "approveBuilderFee") {
    const { typedData, action: filled, nonce: usedNonce } =
      buildApproveBuilderFeeTypedData(action, {
        builder: cfg.ALCHEMY_BUILDER_ADDRESS,
        isTestnet: cfg.isTestnet,
        nonce,
      });
    // For user-signed actions there's no separate L1 hash to surface — the
    // client signs the typed data directly and gets the digest from their
    // wallet's signing flow. We return the EIP-712 digest as a courtesy
    // (the same value the wallet computes internally).
    return {
      hash: hashTypedDataDigest(typedData),
      nonce: usedNonce,
      action: filled,
      isSpot: false,
      builderFee: 0,
      builder: cfg.ALCHEMY_BUILDER_ADDRESS,
      typedData,
    };
  }

  if (action.type === "cancel" || action.type === "cancelByCloid") {
    const { hash, typedData } = phantomAgentTypedData(action, nonce, {
      isTestnet: cfg.isTestnet,
    });
    return {
      hash,
      nonce,
      action,
      isSpot: false,
      builderFee: 0,
      builder: cfg.ALCHEMY_BUILDER_ADDRESS,
      typedData,
    };
  }

  // Exhaustiveness — TS will catch new variants at compile time.
  const _exhaustive: never = action;
  throw new ApiException(
    "INVALID_PARAMS",
    `Unsupported action type.`,
    "Use one of: order, cancel, cancelByCloid, approveBuilderFee.",
  );
}

function hashTypedDataDigest(td: import("@alchemy-hl/shared").EIP712TypedData): `0x${string}` {
  return hashTypedData({
    domain: td.domain,
    types: td.types,
    primaryType: td.primaryType,
    message: td.message,
  });
}

function zodToApi(err: unknown): ApiException {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const path = first?.path.join(".") ?? "(root)";
    return new ApiException(
      "INVALID_PARAMS",
      `Bad shape at ${path}: ${first?.message ?? "validation failed"}`,
      "Check the action schema. See the API docs for the exact field names and types.",
    );
  }
  return new ApiException(
    "INVALID_JSON",
    "Request body could not be parsed.",
    "Send a JSON object with at minimum an `action` field. Set content-type to application/json.",
  );
}
