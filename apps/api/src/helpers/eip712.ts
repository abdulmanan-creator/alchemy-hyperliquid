/**
 * EIP-712 typed data for Hyperliquid's user-signed actions.
 *
 * Hyperliquid splits its signing into two schemes:
 *   - L1 actions (`order`, `cancel`, …)        → phantom-agent envelope (hash.ts)
 *   - User-signed actions (approveBuilderFee,
 *     approveAgent, withdraw3, …)              → direct EIP-712, this file
 *
 * For approveBuilderFee, the message the user signs is the action itself,
 * encoded as EIP-712 typed data. The signature chainId is *always* Arbitrum
 * mainnet (0xa4b1) even when the underlying Hyperliquid chain is testnet —
 * that's the chain MetaMask shows in the popup. The `hyperliquidChain` field
 * inside the message disambiguates mainnet vs testnet.
 */

import type { ApproveBuilderFeeAction, EIP712TypedData } from "@alchemy-hl/shared";

const ARBITRUM_MAINNET_CHAIN_ID_HEX = "0xa4b1" as const;
const ARBITRUM_MAINNET_CHAIN_ID = 42161;

const USER_SIGNED_DOMAIN = {
  name: "HyperliquidSignTransaction",
  version: "1",
  chainId: ARBITRUM_MAINNET_CHAIN_ID,
  verifyingContract: "0x0000000000000000000000000000000000000000",
} as const;

const APPROVE_BUILDER_FEE_TYPES = {
  "HyperliquidTransaction:ApproveBuilderFee": [
    { name: "hyperliquidChain", type: "string" },
    { name: "maxFeeRate", type: "string" },
    { name: "builder", type: "address" },
    { name: "nonce", type: "uint64" },
  ],
} as const;

/**
 * Build the typed-data envelope + the final, fully-populated action that will
 * be POSTed to Hyperliquid /exchange in phase B.
 *
 * The server fills in `builder`, `nonce`, `hyperliquidChain`, `signatureChainId`
 * if the client didn't supply them. We always overwrite `builder` with our
 * own address to prevent any caller from approving fees for a different builder.
 */
export function buildApproveBuilderFeeTypedData(
  action: ApproveBuilderFeeAction,
  opts: { builder: `0x${string}`; isTestnet: boolean; nonce?: number },
): { typedData: EIP712TypedData; action: Required<ApproveBuilderFeeAction>; nonce: number } {
  const nonce = opts.nonce ?? Date.now();
  const hyperliquidChain: "Mainnet" | "Testnet" = opts.isTestnet ? "Testnet" : "Mainnet";

  const filled: Required<ApproveBuilderFeeAction> = {
    type: "approveBuilderFee",
    hyperliquidChain,
    maxFeeRate: action.maxFeeRate,
    builder: opts.builder,
    nonce,
    signatureChainId: ARBITRUM_MAINNET_CHAIN_ID_HEX,
  };

  const typedData: EIP712TypedData = {
    domain: { ...USER_SIGNED_DOMAIN },
    types: APPROVE_BUILDER_FEE_TYPES as unknown as EIP712TypedData["types"],
    primaryType: "HyperliquidTransaction:ApproveBuilderFee",
    message: {
      hyperliquidChain: filled.hyperliquidChain,
      maxFeeRate: filled.maxFeeRate,
      builder: filled.builder,
      nonce: filled.nonce,
    },
  };

  return { typedData, action: filled, nonce };
}
