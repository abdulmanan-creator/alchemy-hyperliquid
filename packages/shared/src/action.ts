/**
 * Hyperliquid action types we proxy through /exchange.
 *
 * These mirror Hyperliquid's on-the-wire shapes. The backend builds them,
 * the client signs them, and the backend forwards the signed payload.
 */

/** Builder info attached to order actions. */
export interface BuilderInfo {
  /** Builder wallet address (Alchemy's). */
  b: `0x${string}`;
  /** Fee in basis points. */
  f: number;
}

/** A single limit order leg inside an `order` action. */
export interface OrderLeg {
  /** Asset id (perp index, or 10000 + spot pair index for spot). */
  a: number;
  /** True = buy. */
  b: boolean;
  /** Price as a decimal string. */
  p: string;
  /** Size as a decimal string. */
  s: string;
  /** Reduce-only. */
  r: boolean;
  /** Order type. */
  t:
    | { limit: { tif: "Alo" | "Ioc" | "Gtc" } }
    | { trigger: { isMarket: boolean; triggerPx: string; tpsl: "tp" | "sl" } };
  /** Optional client order id. */
  c?: `0x${string}`;
}

/** L1 `order` action — multi-leg orders. */
export interface OrderAction {
  type: "order";
  orders: OrderLeg[];
  grouping: "na" | "normalTpsl" | "positionTpsl";
  builder?: BuilderInfo;
}

/** L1 `cancel` action — cancel by oid. */
export interface CancelAction {
  type: "cancel";
  cancels: { a: number; o: number }[];
}

/** L1 `cancelByCloid` action. */
export interface CancelByCloidAction {
  type: "cancelByCloid";
  cancels: { asset: number; cloid: `0x${string}` }[];
}

/**
 * User-signed `approveBuilderFee` action (EIP-712).
 *
 * The frontend submits this without a signature first to get the typed-data
 * envelope back from /exchange; signs it locally; reposts with the sig.
 */
export interface ApproveBuilderFeeAction {
  type: "approveBuilderFee";
  /** "Mainnet" or "Testnet". */
  hyperliquidChain?: "Mainnet" | "Testnet";
  /** e.g. "0.001%" — Hyperliquid uses string percentages. */
  maxFeeRate: string;
  /** Builder address being approved. Server fills if absent. */
  builder?: `0x${string}`;
  /** Nonce. Server fills if absent (Date.now()). */
  nonce?: number;
  /** Signature chain id, hex string. Arbitrum mainnet = "0xa4b1". */
  signatureChainId?: `0x${string}`;
}

/**
 * User-signed `approveAgent` action (EIP-712).
 *
 * Delegates trading authority on the user's HL account to a separate "agent
 * wallet" identified by `agentAddress`. After this is approved, the agent key
 * can sign trades that HL credits to the approving user — no withdrawal
 * permission, only trading. Used to enable unattended AI trading: user signs
 * this once via Privy, server signs subsequent trades using the per-user
 * agent key derived from AGENT_MASTER_SEED.
 *
 * Set `agentAddress` to all-zeros to revoke an existing agent (matches HL's
 * convention for revocation through the same action).
 */
export interface ApproveAgentAction {
  type: "approveAgent";
  /** "Mainnet" or "Testnet". */
  hyperliquidChain?: "Mainnet" | "Testnet";
  /** Agent wallet being approved. Server fills if absent, using AGENT_MASTER_SEED derivation. */
  agentAddress?: `0x${string}`;
  /** Optional friendly name HL stores alongside the approval. Server fills "Alchemy" if absent. */
  agentName?: string;
  /** Nonce. Server fills with Date.now() if absent. */
  nonce?: number;
  /** Signature chain id, hex string. Arbitrum mainnet = "0xa4b1". */
  signatureChainId?: `0x${string}`;
}

/** Union of every action the backend understands. */
export type Action =
  | OrderAction
  | CancelAction
  | CancelByCloidAction
  | ApproveBuilderFeeAction
  | ApproveAgentAction;

/** Compact ECDSA signature shape. */
export interface Signature {
  r: `0x${string}`;
  s: `0x${string}`;
  v: number;
}

/** Phase A request — no signature yet, asking the server to build the payload. */
export interface BuildRequest {
  action: Action;
}

/** Phase A response — what to sign + everything the client needs to re-post. */
export interface BuildResponse {
  /** Canonical hash the client signs (L1) or the EIP-712 digest (user-signed). */
  hash: `0x${string}`;
  /** Server-chosen nonce. */
  nonce: number;
  /** Action with builder info / fee injected. */
  action: Action;
  /** True iff any order leg targets a spot asset. */
  isSpot: boolean;
  /** Effective builder fee in bps (after injection). */
  builderFee: number;
  /** Echo of the builder address used. */
  builder: `0x${string}`;
  /** Present for user-signed actions (approveBuilderFee). */
  typedData?: EIP712TypedData;
}

/** Phase B request — built action + nonce + signature; server forwards to HL. */
export interface SendRequest {
  action: Action;
  nonce: number;
  signature: Signature;
}

/** Phase B response — Hyperliquid's verdict + recovered signer. */
export interface SendResponse {
  success: boolean;
  user: `0x${string}`;
  exchangeResponse: unknown;
}

/** EIP-712 typed data envelope (subset we actually use). */
export interface EIP712TypedData {
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
