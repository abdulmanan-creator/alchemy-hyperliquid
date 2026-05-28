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
