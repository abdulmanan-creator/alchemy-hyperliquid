/**
 * Hyperliquid action hashing + the "phantom-agent" EIP-712 envelope L1 actions
 * are actually signed against.
 *
 * Hyperliquid's spec for L1 actions (`order`, `cancel`, `cancelByCloid`, …):
 *
 *   action_hash = keccak256(
 *       msgpack(action)                                  // canonical encoding
 *     + nonce.toBigEndian(8 bytes)                       // u64 BE
 *     + (vaultAddress === null
 *           ? 0x00                                       // 1 byte
 *           : 0x01 + bytes(vaultAddress))                // 21 bytes
 *   )
 *
 * That hash is then wrapped in an EIP-712 envelope and signed:
 *
 *   domain: { name: "Exchange", version: "1", chainId: 1337,
 *             verifyingContract: 0x0…0 }                 // note: chainId 1337
 *   types:  Agent = { source: string, connectionId: bytes32 }
 *   message: { source: "a" (mainnet) | "b" (testnet),
 *              connectionId: action_hash }
 *
 * Notes:
 *   - The chainId in the L1 phantom-agent domain is always 1337, regardless
 *     of which network the order is for. The mainnet/testnet split lives in
 *     the `source` field of the message.
 *   - User-signed actions (approveBuilderFee, withdraw3, …) use a *different*
 *     EIP-712 schema; see eip712.ts.
 */

import { encode as msgpackEncode } from "@msgpack/msgpack";
import { keccak256, toBytes, type Hex } from "viem";

import type { Action, EIP712TypedData } from "@alchemy-hl/shared";

const PHANTOM_AGENT_DOMAIN = {
  name: "Exchange",
  version: "1",
  chainId: 1337,
  verifyingContract: "0x0000000000000000000000000000000000000000",
} as const;

const PHANTOM_AGENT_TYPES = {
  Agent: [
    { name: "source", type: "string" },
    { name: "connectionId", type: "bytes32" },
  ],
} as const;

/**
 * Canonical L1 action hash (the `connectionId` in the phantom-agent envelope).
 */
export function l1ActionHash(
  action: Action,
  nonce: number,
  vaultAddress: `0x${string}` | null = null,
): Hex {
  const packed = msgpackEncode(action, { ignoreUndefined: true });

  // 8-byte big-endian nonce.
  const nonceBytes = new Uint8Array(8);
  const view = new DataView(nonceBytes.buffer);
  view.setBigUint64(0, BigInt(nonce), false /* big-endian */);

  let suffix: Uint8Array;
  if (vaultAddress === null) {
    suffix = new Uint8Array([0x00]);
  } else {
    const addr = toBytes(vaultAddress);
    if (addr.length !== 20) throw new Error("vault address must be 20 bytes");
    suffix = new Uint8Array(21);
    suffix[0] = 0x01;
    suffix.set(addr, 1);
  }

  const total = new Uint8Array(packed.length + nonceBytes.length + suffix.length);
  total.set(packed, 0);
  total.set(nonceBytes, packed.length);
  total.set(suffix, packed.length + nonceBytes.length);

  return keccak256(total);
}

/**
 * Build the phantom-agent EIP-712 envelope for an L1 action. Wagmi's
 * `signTypedData` consumes this directly. The recovered signature is what we
 * forward to Hyperliquid's /exchange endpoint.
 */
export function phantomAgentTypedData(
  action: Action,
  nonce: number,
  opts: { isTestnet: boolean; vaultAddress?: `0x${string}` | null } = {
    isTestnet: false,
  },
): { hash: Hex; typedData: EIP712TypedData } {
  const hash = l1ActionHash(action, nonce, opts.vaultAddress ?? null);
  const typedData: EIP712TypedData = {
    domain: { ...PHANTOM_AGENT_DOMAIN },
    types: PHANTOM_AGENT_TYPES as unknown as EIP712TypedData["types"],
    primaryType: "Agent",
    message: {
      source: opts.isTestnet ? "b" : "a",
      connectionId: hash,
    },
  };
  return { hash, typedData };
}
