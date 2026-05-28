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
