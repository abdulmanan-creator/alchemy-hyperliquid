/**
 * MCP server config. Loaded from env at process start.
 *
 * Env vars:
 *   ALCHEMY_HL_API_URL   - URL of our backend's /exchange API
 *                          (default: http://localhost:8080)
 *   ALCHEMY_HL_TRADE_KEY - Hot key for trading. Optional — if absent,
 *                          write tools (place_*, cancel_*) return "no
 *                          signer configured" and the connector becomes
 *                          read-only.
 *   LOG_LEVEL            - "debug" | "info" | "warn" | "error"
 *                          (default: "info", logs to stderr only — stdout
 *                          is reserved for MCP protocol JSON-RPC frames)
 */

import { z } from "zod";

const ConfigSchema = z.object({
  ALCHEMY_HL_API_URL: z.string().url().default("http://localhost:8080"),
  ALCHEMY_HL_TRADE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "must be 0x + 64 hex chars (32 bytes)")
    .optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof ConfigSchema> & {
  hasSigner: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.parse(env);
  return { ...parsed, hasSigner: !!parsed.ALCHEMY_HL_TRADE_KEY };
}

const LEVELS: Record<Config["LOG_LEVEL"], number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Logger that writes to stderr. CRITICAL: MCP protocol uses stdout for
 * JSON-RPC frames; anything we write to stdout breaks the transport. All
 * logging must go to stderr.
 */
export function makeLogger(cfg: Config) {
  const threshold = LEVELS[cfg.LOG_LEVEL];
  function log(level: Config["LOG_LEVEL"], msg: string, meta?: unknown) {
    if (LEVELS[level] < threshold) return;
    const line = meta !== undefined ? `[${level}] ${msg} ${JSON.stringify(meta)}` : `[${level}] ${msg}`;
    process.stderr.write(line + "\n");
  }
  return {
    debug: (m: string, x?: unknown) => log("debug", m, x),
    info: (m: string, x?: unknown) => log("info", m, x),
    warn: (m: string, x?: unknown) => log("warn", m, x),
    error: (m: string, x?: unknown) => log("error", m, x),
  };
}
