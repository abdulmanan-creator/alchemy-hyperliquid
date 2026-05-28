import type { FastifyInstance } from "fastify";

import type { DexInfo, DexesResponse } from "@alchemy-hl/shared";

import { HlClient } from "../helpers/hlClient.js";

/**
 * GET /dexes — HIP-3 permissionless dex enumeration.
 *
 * Hyperliquid's info endpoint `perpDexs` returns an array of dex descriptors.
 * The default Hyperliquid dex shows up as `null` in slot 0; everything else
 * is a permissionless deployment. We flatten that into a simple list.
 *
 * If/when HL adds a builder-fee-per-dex field, surface it via the
 * `builderFeeBps` field on DexInfo — it's optional on our type for that
 * reason.
 */
export async function dexesRoute(app: FastifyInstance): Promise<void> {
  const hl = new HlClient({
    baseUrl: app.config.HYPERLIQUID_API_URL,
    logger: { warn: app.log.warn.bind(app.log) },
  });

  app.get("/dexes", async (_req, reply) => {
    const raw = await hl.info<HlPerpDex[]>({ type: "perpDexs" });

    const dexes: DexInfo[] = (raw ?? [])
      .filter((d): d is HlPerpDex => d !== null && typeof d === "object")
      .map((d) => {
        const dex: DexInfo = {
          name: d.name ?? "(unnamed)",
          address: (d.full_name as `0x${string}` | undefined) ?? d.deployer ?? "0x0000000000000000000000000000000000000000",
        };
        return dex;
      });

    const out: DexesResponse = { dexes };
    return reply.send(out);
  });
}

// HL's perpDexs entries are loosely shaped — these are the fields we've seen
// in the wild; everything is optional and we tolerate nulls in slot 0.
interface HlPerpDex {
  name?: string;
  full_name?: string;
  deployer?: `0x${string}`;
}
