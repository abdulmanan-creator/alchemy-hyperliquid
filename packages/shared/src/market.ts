/**
 * Market metadata returned by GET /markets.
 *
 * Hyperliquid exposes perps via `meta` and spot via `spotMeta`. HIP-3 and HIP-4
 * are permissionless surfaces — for now we only echo the placeholders; the real
 * HIP-3 dex enumeration lives at GET /dexes.
 */

export interface PerpAsset {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  /** Asset index used in order actions. */
  assetIndex: number;
}

export interface SpotAsset {
  name: string;
  /** Base token symbol. */
  base: string;
  /** Quote token symbol. */
  quote: string;
  /** Asset index used in order actions (10000 + pair index, per HL convention). */
  assetIndex: number;
  szDecimals: number;
}

export interface MarketsResponse {
  perps: PerpAsset[];
  spot: SpotAsset[];
  /** HIP-3 permissionless dexes the user can route through. */
  hip3: { name: string; address: `0x${string}` }[];
  /** HIP-4 markets, if any. */
  hip4: unknown[];
}

export interface DexInfo {
  name: string;
  address: `0x${string}`;
  /** Builder fee bps required by that dex's deployer, if known. */
  builderFeeBps?: number;
}

export interface DexesResponse {
  dexes: DexInfo[];
}

/**
 * Live per-asset stats from HL's metaAndAssetCtxs / spotMetaAndAssetCtxs.
 * Returned as a separate /marketStats payload (rather than baked into
 * /markets) so the existing /markets call — used hot by the SDK / MCP
 * symbol resolver — doesn't pay the extra latency.
 */
export interface MarketStat {
  /** Asset index (same as MarketsResponse — perps 0..N, spot 10000..N). */
  assetIndex: number;
  /** Symbol, for join convenience without re-fetching /markets. */
  name: string;
  /** Mark price as a decimal string. */
  markPx?: string;
  /** Mid price (between best bid/ask). */
  midPx?: string;
  /** Previous-day close. */
  prevDayPx?: string;
  /** 24h notional volume (USD). */
  dayNtlVlm?: string;
  /** Open interest (perps only). */
  openInterest?: string;
  /** Funding rate per 8h (perps only). */
  funding?: string;
}

export interface MarketStatsResponse {
  perps: MarketStat[];
  spot: MarketStat[];
}

/**
 * Top-of-book snapshot for one asset. Returned by /l2Book.
 */
export interface L2Level {
  px: string;
  sz: string;
  n: number;
}

export interface L2BookResponse {
  /** Symbol name. */
  coin: string;
  /** Server-side time of snapshot, ms. */
  time: number;
  /** Bids and asks, each sorted best-first. */
  levels: [L2Level[], L2Level[]];
}

/**
 * User trade history. Returned by /userFills.
 */
export interface UserFill {
  /** Symbol traded. */
  coin: string;
  /** Fill price. */
  px: string;
  /** Fill size in base units. */
  sz: string;
  /** "B" for buy fills, "A" for sell (HL convention). */
  side: "B" | "A";
  /** Fill timestamp, ms. */
  time: number;
  /** Fill order id. */
  oid: number;
  /** Order direction string from HL ("Open Long", "Close Long", "Open Short", "Close Short"). */
  dir?: string;
  /** Fee paid to HL (signed; negative = rebate). USDC. */
  fee?: string;
  /** Fee paid to the builder (Alchemy). USDC. Critical for revenue analytics. */
  builderFee?: string;
  /** Closed PnL if this fill closed a position; "0.0" otherwise. */
  closedPnl?: string;
  /** HL trade id. */
  tid?: number;
  /** Tx hash on HL's chain. */
  hash?: string;
}

export interface UserFillsResponse {
  user: `0x${string}`;
  fills: UserFill[];
}
