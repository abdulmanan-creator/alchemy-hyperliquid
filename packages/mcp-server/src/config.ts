/**
 * MCP server config. Loaded from env at process start.
 *
 * The server runs in one of two transport modes — stdio (default, for Claude
 * desktop) or http (for Claude Web + ChatGPT + any hosted MCP host). Pick via
 * MCP_TRANSPORT.
 *
 * Auth:
 *   - stdio mode: ALCHEMY_HL_TRADE_KEY is a hot private key on this process.
 *     One key = one user. Suitable for single-user power-user setups.
 *   - http mode:  per-request auth via Authorization: Bearer <privy-jwt> from
 *     the calling host (Claude/ChatGPT). MCP server forwards the JWT to the
 *     backend's /agent/exchange path; backend signs with the user's per-user
 *     agent key. Multi-tenant. No keys on this process.
 *
 * Env vars:
 *   ALCHEMY_HL_API_URL    URL of our backend's /exchange API (default localhost:8080)
 *   MCP_TRANSPORT         "stdio" | "http"  (default "stdio")
 *   MCP_PORT              http listen port  (default 3001, only used when http)
 *   ALCHEMY_HL_TRADE_KEY  hot key for stdio mode (32 bytes hex, optional → read-only mode)
 *   LOG_LEVEL             "debug" | "info" | "warn" | "error" (default "info")
 *                         logs go to stderr only in stdio mode (protocol owns stdout);
 *                         http mode logs may also go to stdout.
 */

import { z } from "zod";

const ConfigSchema = z.object({
  ALCHEMY_HL_API_URL: z.string().url().default("http://localhost:8080"),
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  // HTTP listen port. Render / Fly / Heroku inject PORT; MCP_PORT is the
  // explicit local-dev override. PORT wins when both are set.
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  MCP_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  ALCHEMY_HL_TRADE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "must be 0x + 64 hex chars (32 bytes)")
    .optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = Omit<z.infer<typeof ConfigSchema>, "PORT" | "MCP_PORT"> & {
  hasSigner: boolean;
  /** Effective HTTP port: PORT (host-injected) wins, falls back to MCP_PORT. */
  httpPort: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.parse(env);
  return {
    ALCHEMY_HL_API_URL: parsed.ALCHEMY_HL_API_URL,
    MCP_TRANSPORT: parsed.MCP_TRANSPORT,
    ALCHEMY_HL_TRADE_KEY: parsed.ALCHEMY_HL_TRADE_KEY,
    LOG_LEVEL: parsed.LOG_LEVEL,
    hasSigner: !!parsed.ALCHEMY_HL_TRADE_KEY,
    httpPort: parsed.PORT ?? parsed.MCP_PORT,
  };
}

const LEVELS: Record<Config["LOG_LEVEL"], number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Logger that writes to stderr. CRITICAL in stdio mode: MCP protocol uses
 * stdout for JSON-RPC frames; anything we write to stdout breaks the
 * transport. In http mode logging to stderr is still fine and matches the
 * stdio mode's behavior for log consistency.
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
