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

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";

import { loadConfig, makeLogger } from "./config.js";
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
    // ChatGPT from chatgpt.com). Permissive in dev — production should
    // tighten to specific origins or sit behind an auth gateway.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, MCP-Session-Id, Mcp-Session-Id",
    );
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Extract Authorization: Bearer <jwt>.
    const authHeader = (req.headers.authorization ?? req.headers.Authorization) as
      | string
      | undefined;
    const match = authHeader?.match(/^Bearer\s+(.+)$/i);
    const agentJwt = match?.[1];

    try {
      const server = makeMcpServer({ agentJwt });
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

  httpServer.listen(cfg.MCP_PORT, () => {
    log.info("listening", {
      transport: "http",
      port: cfg.MCP_PORT,
      url: `http://localhost:${cfg.MCP_PORT}`,
    });
  });
}
