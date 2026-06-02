/**
 * Signature verification on /exchange Phase B.
 *
 * We *recover* the signer from the signature rather than verifying against
 * a claimed address. The recovered EOA is the authoritative user identity —
 * the client doesn't need to send their address separately, and there's no
 * way to spoof someone else (recovery either yields their address or it
 * doesn't, in which case the upstream call will reject).
 *
 * Two envelopes we know how to reverse:
 *   1. L1 actions (`order`, `cancel`, …)  → phantom-agent EIP-712
 *   2. approveBuilderFee                  → HyperliquidTransaction EIP-712
 */

import { recoverTypedDataAddress, type Hex } from "viem";

import type { Action, Signature } from "@alchemy-hl/shared";

import type { Config } from "../config.js";
import { ApiException } from "../errors.js";
import { phantomAgentTypedData } from "./hash.js";
import {
  buildApproveAgentTypedData,
  buildApproveBuilderFeeTypedData,
} from "./eip712.js";
import { AGENT_NAME } from "./agent.js";

function packSig(sig: Signature): Hex {
  const r = sig.r.replace(/^0x/, "").padStart(64, "0");
  const s = sig.s.replace(/^0x/, "").padStart(64, "0");
  const v = sig.v.toString(16).padStart(2, "0");
  return `0x${r}${s}${v}` as Hex;
}

export async function recoverActionSigner(
  action: Action,
  nonce: number,
  sig: Signature,
  cfg: Config,
): Promise<`0x${string}`> {
  const packed = packSig(sig);

  let typedData;
  if (action.type === "approveBuilderFee") {
    typedData = buildApproveBuilderFeeTypedData(action, {
      builder: cfg.ALCHEMY_BUILDER_ADDRESS,
      isTestnet: cfg.isTestnet,
      nonce,
    }).typedData;
  } else if (action.type === "approveAgent") {
    // For verification we need the agentAddress that was in the typed data
    // when the user signed. The action object the client re-sends carries it
    // (filled by build phase), so just re-derive the envelope around the
    // values present on the action. If the action somehow has no
    // agentAddress, we can't recover; surface as SIGNATURE_INVALID.
    if (!action.agentAddress) {
      throw new ApiException(
        "SIGNATURE_INVALID",
        "approveAgent send phase is missing agentAddress.",
        "Send phase must include the same action object returned by build phase, with agentAddress populated.",
      );
    }
    typedData = buildApproveAgentTypedData(action, {
      agentAddress: action.agentAddress,
      agentName: action.agentName ?? AGENT_NAME,
      isTestnet: cfg.isTestnet,
      nonce,
    }).typedData;
  } else {
    typedData = phantomAgentTypedData(action, nonce, {
      isTestnet: cfg.isTestnet,
    }).typedData;
  }

  try {
    const signer = await recoverTypedDataAddress({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
      signature: packed,
    });
    return signer;
  } catch (err) {
    throw new ApiException(
      "SIGNATURE_INVALID",
      `Could not recover signer from signature: ${(err as Error).message}`,
      "Make sure the wallet signed the exact `typedData` returned by the build phase. Sig components must be 32-byte r/s and v ∈ {27,28}.",
    );
  }
}
