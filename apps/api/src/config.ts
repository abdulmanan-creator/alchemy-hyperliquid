/**
 * Typed, validated config loaded once at process start.
 *
 * Reads from process.env (which is populated by dotenv via --env-file in dev,
 * or by Render/host in prod). Crashes early on bad config — better than
 * silently injecting a zero-address builder code into someone's order.
 */

import { getAddress } from "viem";
import { z } from "zod";

const HEX_ADDR = /^0x[0-9a-fA-F]{40}$/;

const ConfigSchema = z.object({
  ALCHEMY_BUILDER_ADDRESS: z
    .string()
    .regex(HEX_ADDR, "must be a 0x-prefixed 20-byte address"),
  HYPERLIQUID_API_URL: z.string().url(),
  PERPS_BUILDER_FEE_BPS: z.coerce.number().int().min(0),
  SPOT_BUILDER_FEE_BPS: z.coerce.number().int().min(0),
  MAX_BUILDER_FEE_BPS_PERPS: z.coerce.number().int().min(0).default(10),
  MAX_BUILDER_FEE_BPS_SPOT: z.coerce.number().int().min(0).default(100),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Config = Omit<
  z.infer<typeof ConfigSchema>,
  "ALCHEMY_BUILDER_ADDRESS"
> & {
  ALCHEMY_BUILDER_ADDRESS: `0x${string}`;
  /** Lowercased copy of the builder address for case-insensitive compares. */
  builderAddressLower: string;
  /** True iff HYPERLIQUID_API_URL points at testnet (best-effort heuristic). */
  isTestnet: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.parse(env);

  // Cap-check the configured fees against protocol maxima. Crash on misconfig.
  if (parsed.PERPS_BUILDER_FEE_BPS > parsed.MAX_BUILDER_FEE_BPS_PERPS) {
    throw new Error(
      `PERPS_BUILDER_FEE_BPS (${parsed.PERPS_BUILDER_FEE_BPS}) > MAX_BUILDER_FEE_BPS_PERPS (${parsed.MAX_BUILDER_FEE_BPS_PERPS})`,
    );
  }
  if (parsed.SPOT_BUILDER_FEE_BPS > parsed.MAX_BUILDER_FEE_BPS_SPOT) {
    throw new Error(
      `SPOT_BUILDER_FEE_BPS (${parsed.SPOT_BUILDER_FEE_BPS}) > MAX_BUILDER_FEE_BPS_SPOT (${parsed.MAX_BUILDER_FEE_BPS_SPOT})`,
    );
  }

  // viem's typed-data hashing rejects non-EIP-55-checksummed mixed-case
  // addresses, so we normalize at load time. getAddress also validates the
  // address shape (length + hex).
  const checksummed = getAddress(parsed.ALCHEMY_BUILDER_ADDRESS);

  return {
    ...parsed,
    ALCHEMY_BUILDER_ADDRESS: checksummed,
    builderAddressLower: checksummed.toLowerCase(),
    isTestnet: parsed.HYPERLIQUID_API_URL.includes("testnet"),
  };
}
