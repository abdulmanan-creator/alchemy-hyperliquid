#!/usr/bin/env node

/**
 * Alchemy Hyperliquid MCP server.
 *
 * Speaks the Model Context Protocol over stdio. Spawned by Claude desktop
 * (or any MCP-compatible host); communicates via JSON-RPC frames on stdout.
 *
 * To wire into Claude desktop:
 *   1. Build: `npm run build -w @alchemy-hl/mcp-server`
 *   2. Add to ~/Library/Application Support/Claude/claude_desktop_config.json:
 *      {
 *        "mcpServers": {
 *          "alchemy-hyperliquid": {
 *            "command": "node",
 *            "args": ["/absolute/path/to/packages/mcp-server/dist/index.js"],
 *            "env": {
 *              "ALCHEMY_HL_API_URL": "http://localhost:8080",
 *              "ALCHEMY_HL_TRADE_KEY": "0x..."
 *            }
 *          }
 *        }
 *      }
 *   3. Restart Claude desktop. The connector shows up as "alchemy-hyperliquid"
 *      with all our tools listed.
 *
 * CRITICAL stdio rule: NEVER write to stdout from this process except via the
 * MCP protocol. Logging must go to stderr. See config.ts logger.
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";

import { loadConfig, makeLogger } from "./config.js";
import { buildTools } from "./tools.js";

// Load .env from repo root if running locally — matches the pattern the API
// uses. Optional; in production Claude desktop passes env via the config.
const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, "../../../.env");
if (existsSync(rootEnv)) dotenv.config({ path: rootEnv });

const cfg = loadConfig();
const log = makeLogger(cfg);

const tools = buildTools(cfg);
const toolsByName = new Map(tools.map((t) => [t.name, t]));

log.info("starting", { apiUrl: cfg.ALCHEMY_HL_API_URL, hasSigner: cfg.hasSigner, toolCount: tools.length });

const server = new Server(
  { name: "alchemy-hyperliquid", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
    })),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = toolsByName.get(req.params.name);
  if (!tool) {
    return {
      content: [{ type: "text" as const, text: `Unknown tool: ${req.params.name}` }],
      isError: true,
    };
  }
  try {
    log.debug("tool_call", { name: req.params.name, args: req.params.arguments });
    const result = await tool.handler(req.params.arguments ?? {});
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

const transport = new StdioServerTransport();
await server.connect(transport);
log.info("connected", { transport: "stdio" });
