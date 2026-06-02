/**
 * Symbol → asset index resolution, cached per-client.
 *
 * Perp asset index = position in HL's perp universe (0 = BTC, 1 = ETH, …).
 * Spot asset index = 10000 + position in HL's spot universe.
 *
 * Callers pass symbols like "BTC", "ETH"; this module fetches
 * `/markets` once (or whenever the cache expires) and resolves.
 *
 * Symbols are uppercased on lookup so "btc" / "BTC" / "Btc" all work.
 */

import type { MarketsResponse } from "@alchemy-hl/shared";

import { SdkInputError } from "./errors.js";

export interface AssetInfo {
  symbol: string;
  assetIndex: number;
  isSpot: boolean;
  szDecimals: number;
}

const CACHE_TTL_MS = 60_000;

export class AssetCache {
  private fetchMarkets: () => Promise<MarketsResponse>;
  private cache: { fetchedAt: number; index: Map<string, AssetInfo> } | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(fetchMarkets: () => Promise<MarketsResponse>) {
    this.fetchMarkets = fetchMarkets;
  }

  async resolve(symbol: string): Promise<AssetInfo> {
    const key = symbol.toUpperCase();
    await this.ensureFresh();
    const hit = this.cache!.index.get(key);
    if (!hit) {
      throw new SdkInputError(
        `Unknown symbol "${symbol}". Try sdk.markets() to list supported assets.`,
      );
    }
    return hit;
  }

  /** Invalidate the cache; next resolve() will re-fetch. */
  invalidate(): void {
    this.cache = null;
  }

  private async ensureFresh(): Promise<void> {
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL_MS) return;
    if (this.inFlight) {
      await this.inFlight;
      return;
    }
    this.inFlight = (async () => {
      try {
        const markets = await this.fetchMarkets();
        const index = new Map<string, AssetInfo>();
        for (const p of markets.perps) {
          index.set(p.name.toUpperCase(), {
            symbol: p.name,
            assetIndex: p.assetIndex,
            isSpot: false,
            szDecimals: p.szDecimals,
          });
        }
        for (const s of markets.spot) {
          // Spot symbols can collide with perp symbols (e.g. spot "BTC" vs perp "BTC").
          // We prefer perp on bare-symbol lookup and require explicit "@spot:BTC"
          // or "BTC/USDC" form for spot. For now: only register spot under its
          // full pair name (e.g. "PURR/USDC").
          index.set(s.name.toUpperCase(), {
            symbol: s.name,
            assetIndex: s.assetIndex,
            isSpot: true,
            szDecimals: s.szDecimals,
          });
        }
        this.cache = { fetchedAt: Date.now(), index };
      } finally {
        this.inFlight = null;
      }
    })();
    await this.inFlight;
  }
}
