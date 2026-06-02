/**
 * HL clearinghouse balance for a wallet. Returned by GET /balance?user=0x...
 *
 * - `accountValue` is the total perp account value in USD (positions + USDC + unrealized PnL).
 * - `withdrawable` is the USDC the user can withdraw right now (account value minus margin used).
 * - `marginUsed` is the USDC currently posted as initial/maintenance margin for open positions.
 *
 * For "did the builder earn a fee" the right number to watch is `accountValue` —
 * builder fee credits land in the perp account and bump it.
 */
export interface BalanceState {
  user: `0x${string}`;
  accountValue: string;
  withdrawable: string;
  marginUsed: string;
  /** Number of open perp positions. */
  openPositions: number;
}

/**
 * Approval-state response from GET /approval?user=0x...
 *
 * Maps Hyperliquid's `maxBuilderFee` raw int into something the UI can render.
 */
export interface ApprovalState {
  /** True iff the user has approved any positive fee for our builder. */
  approved: boolean;
  /** Human-friendly percentage, e.g. "0.04%" or "1%". */
  maxFeeRate: string;
  /** Raw integer Hyperliquid returns (basis points * 10, per their API). */
  maxFeeRaw: number;
  /** True iff the approved cap is high enough to route perps at our configured fee. */
  canTradePerps: boolean;
  /** True iff the approved cap is high enough to route spot at our configured fee. */
  canTradeSpot: boolean;
  feeBreakdown: {
    configuredPerpsBps: number;
    configuredSpotBps: number;
    protocolMaxPerpsBps: number;
    protocolMaxSpotBps: number;
  };
}
