/**
 * Signer abstraction. Two supported shapes today:
 *
 *   - Hot key: pass `{ privateKey: "0x..." }`. The SDK derives a viem account
 *     and signs entirely in-process. Right for agents, scripts, bots.
 *
 *   - External wallet: pass `{ account, signTypedDataAsync }`. The caller
 *     provides a viem-compatible signer object. Right for browser dApps that
 *     use Privy / MetaMask / etc. and don't expose raw private keys.
 *
 * Both shapes resolve to the same `Signer` interface internally.
 */

import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

import { SdkInputError } from "./errors.js";

export interface SignTypedDataParams {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface Signer {
  /** Address this signer signs for. */
  address: `0x${string}`;
  /**
   * Returns a 65-byte hex signature over the typed data. Implementations must
   * produce a signature with v in 27/28 form (legacy format). Hot-key path
   * does this naturally via viem; external-wallet path is normalized in
   * {@link normalizeHexSig} before reaching the SDK's transport layer.
   */
  signTypedData(params: SignTypedDataParams): Promise<Hex>;
}

export interface HotKeyConfig {
  privateKey: Hex;
}

export interface ExternalSignerConfig {
  /** The address that will sign. */
  account: `0x${string}`;
  /**
   * A function that takes typed data and returns a 65-byte hex signature.
   * Use `viem.WalletClient`'s `signTypedData`, or pass `wagmi`'s
   * `signTypedDataAsync`, or roll your own around `eth_signTypedData_v4`.
   */
  signTypedDataAsync: (params: SignTypedDataParams) => Promise<Hex>;
}

export type SignerConfig = HotKeyConfig | ExternalSignerConfig;

export function isHotKeyConfig(s: SignerConfig): s is HotKeyConfig {
  return "privateKey" in s;
}

/**
 * Resolve either config shape to a uniform `Signer` interface. Throws
 * `SdkInputError` on missing/invalid input — distinct from backend errors so
 * callers can tell their own bugs from rejections.
 */
export function makeSigner(cfg: SignerConfig): Signer {
  if (isHotKeyConfig(cfg)) {
    if (!cfg.privateKey?.startsWith("0x")) {
      throw new SdkInputError(
        "Signer.privateKey must be a 0x-prefixed hex string.",
      );
    }
    const account = privateKeyToAccount(cfg.privateKey);
    return {
      address: account.address,
      async signTypedData(params) {
        return account.signTypedData({
          domain: params.domain,
          types: params.types,
          primaryType: params.primaryType,
          message: params.message,
        });
      },
    };
  }

  if (!cfg.account?.startsWith("0x") || !cfg.signTypedDataAsync) {
    throw new SdkInputError(
      "External signer requires `account` (0x-prefixed) and `signTypedDataAsync`.",
    );
  }
  return {
    address: cfg.account,
    signTypedData: cfg.signTypedDataAsync,
  };
}

/**
 * Normalize a 65-byte hex signature to legacy {r, s, v} with v in 27/28.
 * Strips 0x prefix tolerance, validates length, and bumps v if the signer
 * returned 0/1 (yParity / EIP-2098 style).
 *
 * Background: HL's recovery expects v in 27/28. Privy embedded wallets via
 * raw EIP-1193 return 0/1; viem and MetaMask return 27/28. We normalize
 * here so callers can wire any signer without caring about wire format.
 */
export function normalizeHexSig(hex: Hex): {
  r: `0x${string}`;
  s: `0x${string}`;
  v: number;
} {
  const stripped = hex.replace(/^0x/, "");
  if (stripped.length !== 130) {
    throw new SdkInputError(
      `Unexpected signature length ${stripped.length}; expected 130 hex chars (65 bytes).`,
    );
  }
  let v = parseInt(stripped.slice(128, 130), 16);
  if (v < 27) v += 27;
  return {
    r: `0x${stripped.slice(0, 64)}` as `0x${string}`,
    s: `0x${stripped.slice(64, 128)}` as `0x${string}`,
    v,
  };
}
