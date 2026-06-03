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
  /**
   * 32-byte hex master seed used to deterministically derive per-user agent
   * keys for HL approveAgent / unattended trading (Layer 2). Optional — if
   * unset, /exchange will refuse to build approveAgent actions and the
   * /agent/* endpoints return INVALID_PARAMS. Generate with:
   *   openssl rand -hex 32
   * Keep this secret. Anyone with this seed can derive every user's agent
   * key (which can trade their HL account but not withdraw).
   */
  AGENT_MASTER_SEED: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "must be 0x + 64 hex chars (32 bytes)")
    .optional(),
  /**
   * Privy app credentials, server-side. Both required to verify the JWT a
   * client sends in `Authorization: Bearer <token>` for /agent/exchange.
   * Without these, the agent-signing path is disabled. APP_ID is the same
   * public string as NEXT_PUBLIC_PRIVY_APP_ID; APP_SECRET is secret.
   */
  PRIVY_APP_ID: z.string().optional(),
  PRIVY_APP_SECRET: z.string().optional(),
  /**
   * HS256 signing secret for the OAuth tokens our MCP server issues to
   * Claude Web / ChatGPT Apps. Shared between api + mcp + (web app for code
   * issuance). 32 bytes hex. Generate via `openssl rand -hex 32`.
   * Optional — if absent, OAuth endpoints return INVALID_PARAMS and only
   * the Privy-JWT auth path works.
   */
  OAUTH_SIGNING_SECRET: z
    .string()
    .regex(/^[0-9a-fA-F]{32,}$/, "must be at least 16 bytes hex")
    .optional(),
  /**
   * Hard server-side cap on leverage when the agent path signs an
   * updateLeverage action. Users can still set higher leverage via /exchange
   * with their primary wallet signature. Default 10 — conservative for AI
   * agents acting unattended. Raise if your traders need more headroom.
   */
  MAX_AGENT_LEVERAGE_PERPS: z.coerce.number().int().min(1).max(50).default(10),
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
