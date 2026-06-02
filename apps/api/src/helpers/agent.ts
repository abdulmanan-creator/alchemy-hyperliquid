/**
 * Deterministic per-user agent key derivation.
 *
 * For each user that signs `approveAgent`, we derive a unique agent keypair
 * from a single server-side master seed + the user's address. Two properties
 * matter:
 *
 *   1. Deterministic: same user always gets the same agent key, so we don't
 *      need to persist anything — recovered any time from (seed, userAddress).
 *   2. Per-user: each user's agent is unique, matching HL's 1:1 agent-to-user
 *      approval model. The agent's HL account is implicitly the user's, since
 *      HL stored the (user → agent) approval relationship.
 *
 * Trade-off: if AGENT_MASTER_SEED is ever compromised, EVERY user's agent key
 * is also compromised (still bounded — HL agents can only trade, not withdraw,
 * but a thief could still drain positions via adversarial trades). For Phase
 * 1 ship: rotate the master seed by re-derivation + asking users to re-sign
 * approveAgent. For production hardening: HSM, per-user random keys in an
 * encrypted KV store, or sharded derivation.
 *
 * The agent's `agentName` field on HL is fixed at "Alchemy" — HL accepts any
 * string here; it shows up in the user's HL UI as the connected agent name.
 */

import {
  bytesToHex,
  concat,
  hexToBytes,
  keccak256,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const AGENT_NAME = "Alchemy" as const;

/**
 * Derive the agent private key for `userAddress`. Crashes if the master seed
 * isn't a valid 32-byte hex — that's a config error worth surfacing early.
 */
export function deriveAgentKey(
  masterSeed: Hex,
  userAddress: `0x${string}`,
): Hex {
  const seed = hexToBytes(masterSeed);
  if (seed.length !== 32) {
    throw new Error(
      `AGENT_MASTER_SEED must be 32 bytes (got ${seed.length}). Generate with: openssl rand -hex 32`,
    );
  }
  const user = hexToBytes(userAddress);
  if (user.length !== 20) {
    throw new Error(`User address must be 20 bytes (got ${user.length}).`);
  }
  return keccak256(concat([seed, user]));
}

/**
 * Convenience: derive the agent's Ethereum address for `userAddress`. This is
 * what the user will sign in their approveAgent action.
 */
export function deriveAgentAddress(
  masterSeed: Hex,
  userAddress: `0x${string}`,
): `0x${string}` {
  const key = deriveAgentKey(masterSeed, userAddress);
  return privateKeyToAccount(key).address;
}

/** True iff the address looks like the "zero agent" used by HL to revoke. */
export function isZeroAgent(addr: string): boolean {
  return /^0x0+$/i.test(addr);
}

/**
 * Optionally export the derived (seed, address) → agentAddress for ops tools
 * that need to look it up without instantiating an account.
 */
export function debugAgentInfo(masterSeed: Hex, userAddress: `0x${string}`) {
  const key = deriveAgentKey(masterSeed, userAddress);
  const account = privateKeyToAccount(key);
  return {
    user: userAddress,
    agentAddress: account.address,
    // Don't return the key itself — this is for ops debugging only and we'd
    // rather not leave a code path that exposes derived keys to logs.
    keyFingerprint: bytesToHex(hexToBytes(key).slice(0, 4)),
  };
}
