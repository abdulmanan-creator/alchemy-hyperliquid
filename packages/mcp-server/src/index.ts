#!/usr/bin/env node

/**
 * Alchemy Hyperliquid MCP server.
 *
 * Two transport modes, picked by MCP_TRANSPORT env:
 *
 *   stdio (default)
 *     For Claude desktop. Single-user / single-process. The MCP host (Claude
 *     desktop) spawns this binary; we read JSON-RPC frames from stdin, write
 *     to stdout. ALCHEMY_HL_TRADE_KEY in env is the hot key that signs trades.
 *
 *   http
 *     For Claude Web / ChatGPT / any hosted MCP host. Multi-tenant: per-request
 *     auth via Authorization: Bearer <privy-jwt>. We forward the JWT to the
 *     backend's /agent/exchange path; backend signs with the user's per-user
 *     agent key. Listens on MCP_PORT (default 3001).
 *
 * stdio invariant: stdout is reserved for protocol frames. Logging goes to
 * stderr — see config.ts logger. In http mode that constraint relaxes but
 * we keep the same logger for consistency.
 */

import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import { jwtVerify } from "jose";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";

import { loadConfig, makeLogger } from "./config.js";
import { handleOAuthRequest } from "./oauth.js";
import { buildTools, type AuthContext } from "./tools.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, "../../../.env");
if (existsSync(rootEnv)) dotenv.config({ path: rootEnv });

const cfg = loadConfig();
const log = makeLogger(cfg);

const tools = buildTools(cfg);
const toolsByName = new Map(tools.map((t) => [t.name, t]));

log.info("starting", {
  transport: cfg.MCP_TRANSPORT,
  apiUrl: cfg.ALCHEMY_HL_API_URL,
  hasHotSigner: cfg.hasSigner,
  toolCount: tools.length,
});

/**
 * Build a fresh MCP Server instance with handlers bound to the given auth
 * context. We re-create per http session because the StreamableHTTP transport
 * documents per-session servers as the canonical pattern (each session is
 * independent), and so we can carry per-request auth into tool handlers.
 */
function makeMcpServer(auth: AuthContext): Server {
  const server = new Server(
    { name: "alchemy-hyperliquid", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = toolsByName.get(req.params.name);
    if (!tool) {
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${req.params.name}` }],
        isError: true,
      };
    }
    try {
      log.debug("tool_call", {
        name: req.params.name,
        args: req.params.arguments,
        authed: !!auth.agentJwt,
      });
      const result = await tool.handler(req.params.arguments ?? {}, auth);
      return { content: [{ type: "text" as const, text: result }] };
    } catch (err) {
      log.warn("tool_error", { name: req.params.name, err: (err as Error).message });
      return {
        content: [
          { type: "text" as const, text: `Tool error: ${(err as Error).message ?? String(err)}` },
        ],
        isError: true,
      };
    }
  });

  return server;
}

if (cfg.MCP_TRANSPORT === "stdio") {
  // Single shared server instance — stdio is one connection per process.
  // Auth is empty here; the hot-key signer in cfg handles trading.
  const server = makeMcpServer({});
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("connected", { transport: "stdio" });
} else {
  // HTTP transport. One MCP server instance per request — independent sessions.
  // Auth extracted from the request's Authorization header.
  const httpServer = createServer(async (req, res) => {
    // CORS for browser-based MCP hosts (Claude Web runs from claude.ai;
    // ChatGPT from chatgpt.com). Echo the request's Origin instead of `*`
    // so the response is valid when the caller uses credentials mode
    // "include" (browsers reject "*" + credentials). Server-to-server
    // calls (Claude's backend exchanging tokens) don't send an Origin
    // header and don't care about CORS — those still work fine.
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    } else {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, MCP-Session-Id, Mcp-Session-Id",
    );
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Lightweight health probe. Render hits this to decide service readiness;
    // also useful for manual smoke ("curl /healthz") before fighting OAuth.
    // GET-only — MCP protocol uses POST on the root path so we must not
    // shadow that.
    if (req.method === "GET" && (req.url === "/healthz" || req.url === "/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          service: "alchemy-hyperliquid-mcp",
          transport: "http",
          hasOauth: !!cfg.OAUTH_SIGNING_SECRET,
          hasHotSigner: cfg.hasSigner,
          mcpPublicUrl: cfg.MCP_PUBLIC_URL,
          webPublicUrl: cfg.WEB_PUBLIC_URL,
        }),
      );
      return;
    }

    try {
      // 1. OAuth routes (.well-known/oauth-authorization-server,
      //    /oauth/register, /authorize redirect, /oauth/token).
      const handled = await handleOAuthRequest(req, res, cfg, log);
      if (handled) return;

      // 2. MCP protocol — everything else.
      const authHeader = (req.headers.authorization ?? req.headers.Authorization) as
        | string
        | undefined;
      const match = authHeader?.match(/^Bearer\s+(.+)$/i);
      const agentJwt = match?.[1];

      // OAuth gate (MCP authorization spec 2025-06-18). When OAuth is
      // configured, every MCP request must carry a Bearer token. Missing
      // token → 401 + WWW-Authenticate per RFC 6750 / RFC 9728. Clients
      // (Claude Web) follow `resource_metadata` to discover the auth
      // server, run the OAuth flow, and retry with the issued token.
      if (!agentJwt && cfg.OAUTH_SIGNING_SECRET) {
        sendAuthChallenge(res, cfg.MCP_PUBLIC_URL, "unauthorized",
          "Authentication required. See the WWW-Authenticate header for OAuth discovery.");
        log.info("auth_challenge_sent", { path: req.url });
        return;
      }

      // Resolve the authenticated wallet address from the token's `sub`
      // claim so read tools can default to it. With OAuth configured, every
      // legitimate token here is one of our own HS256 access tokens, so we
      // verify it (signature + issuer + audience + expiry) and 401 on
      // failure — expired/tampered tokens get a fresh OAuth handshake
      // instead of a confusing downstream tool error. Without OAuth (bare
      // http dev mode) we fall back to decode-only; the api still verifies
      // before anything is signed.
      let userAddress: `0x${string}` | undefined;
      if (agentJwt && cfg.OAUTH_SIGNING_SECRET) {
        userAddress = await verifySubFromAccessToken(agentJwt, cfg.OAUTH_SIGNING_SECRET);
        if (!userAddress) {
          sendAuthChallenge(res, cfg.MCP_PUBLIC_URL, "invalid_token",
            "Access token is expired or invalid. Re-run the OAuth flow.");
          log.info("invalid_token_rejected", { path: req.url });
          return;
        }
      } else if (agentJwt) {
        userAddress = decodeSubFromJwt(agentJwt);
      }

      const server = makeMcpServer({ agentJwt, userAddress });
      const transport = new StreamableHTTPServerTransport({
        // Stateless mode: each request is independent. MCP hosts that need
        // session continuity (server-streamed notifications) can be added
        // later by switching to sessionIdGenerator: randomUUID.
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      // SDK reads the body itself via the IncomingMessage stream.
      await transport.handleRequest(req, res);
    } catch (err) {
      log.error("http_request_error", { err: (err as Error).message });
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    }
  });

  httpServer.listen(cfg.httpPort, () => {
    log.info("listening", {
      transport: "http",
      port: cfg.httpPort,
      url: `http://localhost:${cfg.httpPort}`,
    });
  });
}

/** 401 + WWW-Authenticate per RFC 6750 / RFC 9728. `error` is the RFC 6750
 *  error code: "unauthorized" (no token) or "invalid_token" (bad/expired). */
function sendAuthChallenge(
  res: import("node:http").ServerResponse,
  mcpPublicUrl: string,
  error: string,
  description: string,
): void {
  const resourceMeta = `${mcpPublicUrl}/.well-known/oauth-protected-resource`;
  res.writeHead(401, {
    "WWW-Authenticate": `Bearer realm="${mcpPublicUrl}", error="${error}", resource_metadata="${resourceMeta}"`,
    "Content-Type": "application/json",
  });
  res.end(JSON.stringify({ error, error_description: description }));
}

/**
 * Verify one of our HS256 access tokens and return its `sub` wallet
 * address, or undefined if the signature, issuer, audience, or expiry
 * check fails. Issuer/audience values must match what the api stamps in
 * apps/api/src/helpers/oauthJwt.ts.
 */
async function verifySubFromAccessToken(
  jwt: string,
  secret: string,
): Promise<`0x${string}` | undefined> {
  try {
    const { payload } = await jwtVerify(jwt, new TextEncoder().encode(secret), {
      issuer: "alchemy-hl-api",
      audience: "alchemy-hl-mcp",
    });
    if (typeof payload.sub === "string" && /^0x[0-9a-fA-F]{40}$/.test(payload.sub)) {
      return payload.sub as `0x${string}`;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Pull the `sub` claim out of a JWT without verifying. Both our OAuth
 * tokens and Privy JWTs put the user's wallet address in `sub`. Returns
 * undefined if the token isn't a well-formed three-part JWS or the
 * claim isn't a 0x-address. Only used when OAuth isn't configured (bare
 * http dev mode); crypto verification still happens on the api when the
 * token is presented to /agent/exchange.
 */
function decodeSubFromJwt(jwt: string): `0x${string}` | undefined {
  const parts = jwt.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const padded = parts[1]!.padEnd(parts[1]!.length + ((4 - (parts[1]!.length % 4)) % 4), "=");
    const payload = JSON.parse(
      Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { sub?: string };
    if (typeof payload.sub === "string" && /^0x[0-9a-fA-F]{40}$/.test(payload.sub)) {
      return payload.sub as `0x${string}`;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
