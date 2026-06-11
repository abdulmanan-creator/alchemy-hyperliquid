# @alchemy-hl/mcp-server

MCP (Model Context Protocol) server for the Alchemy Hyperliquid trading API. Powers the hosted Claude Web / ChatGPT connectors and can also run locally over stdio for Claude desktop and other MCP hosts (Cursor, Continue, etc.).

## Tools

The server exposes 14 tools:

| Tool | Auth needed | What the assistant can do |
|---|---|---|
| `get_markets` | none | List perps + spot markets |
| `get_market_price` | none | Read current mid price for a symbol |
| `get_balance` | none | Read a wallet's HL perp balance |
| `get_positions` | none | Open positions with live PnL, liq price, leverage |
| `get_open_orders` | none | List resting orders for a wallet |
| `get_fills` | none | Recent executions with fees + closed PnL |
| `get_approval` | none | Check builder-fee approval state |
| `place_market_order` | signer | Buy/sell market (IOC) by notional or size |
| `place_limit_order` | signer | Buy/sell limit with Gtc/Ioc/Alo |
| `place_trigger_order` | signer | Take-profit / stop-loss, reduce-only by default |
| `close_position` | signer | Flatten a position (full or partial) reduce-only |
| `cancel_order` | signer | Cancel a resting order by oid |
| `set_leverage` | signer | Set leverage 1–50x, cross or isolated |
| `approve_builder` | signer, user key only | Sign approveBuilderFee (setup or revoke) |

"Signer" is either the per-user agent key (hosted mode) or a local hot key (stdio mode). Without one, the connector is read-only — still useful for an "analyst" agent that proposes trades for human approval.

## Two transports, two signing models

### http — hosted, multi-tenant (production)

This is what serves the Claude Web and ChatGPT connectors at `https://alchemy-hl-mcp.onrender.com`. Set `MCP_TRANSPORT=http`.

- **Auth**: full OAuth 2.0 (RFC 8414 metadata, RFC 7591 dynamic client registration, RFC 9728 protected-resource metadata, PKCE). Requests without a Bearer token get a 401 challenge that triggers the MCP host's OAuth flow; tokens are HS256 JWTs verified against `OAUTH_SIGNING_SECRET` (shared with the api service).
- **Signing**: no keys on this process. The user signs one `approveAgent` action during the OAuth flow (on the web app's `/oauth/authorize` page); the api derives a per-user, trade-only agent key from `AGENT_MASTER_SEED` and signs trades server-side. Agents cannot withdraw — enforced by the Hyperliquid protocol.
- **Users**: multi-tenant; each request carries its own token, read tools default to the authenticated wallet.

End users never touch this README for the hosted flow — point them at `/connect/claude` or `/connect/chatgpt` on the web app.

### stdio — local, single-user (power users / dev)

The default transport. The MCP host (Claude desktop) spawns the binary; one hot key in env signs all trades.

1. Generate a fresh test wallet (don't use your personal key):
   ```bash
   cd packages/sdk && npx tsx scripts/generate-test-wallet.ts
   ```
   Fund it with ~$10 USDC + a little ETH on Arbitrum, deposit USDC into HL, approve the builder fee (via `/approve` or the SDK).
2. Build: `cd packages/mcp-server && npm install && npm run build`
3. Wire into `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):
   ```json
   {
     "mcpServers": {
       "alchemy-hyperliquid": {
         "command": "node",
         "args": ["/absolute/path/to/packages/mcp-server/dist/index.js"],
         "env": {
           "ALCHEMY_HL_API_URL": "https://alchemy-hl-api.onrender.com",
           "ALCHEMY_HL_TRADE_KEY": "0x<your test wallet private key>"
         }
       }
     }
   }
   ```
4. Restart Claude desktop fully (Cmd+Q) and try: *"What's the current BTC price on Hyperliquid?"*

## Environment variables

| Var | Required | Default | Notes |
|---|---|---|---|
| `ALCHEMY_HL_API_URL` | no | `http://localhost:8080` | Backend API URL. |
| `MCP_TRANSPORT` | no | `stdio` | `stdio` or `http`. |
| `MCP_PORT` / `PORT` | no | `3001` | http listen port; host-injected `PORT` wins. |
| `MCP_PUBLIC_URL` | http mode | `http://localhost:<port>` | Public URL of this server; OAuth issuer + metadata base. |
| `WEB_PUBLIC_URL` | http mode | `http://localhost:3000` | Web app URL hosting the `/oauth/authorize` UI. |
| `OAUTH_SIGNING_SECRET` | http mode | unset | HS256 secret, shared with the api service. Without it OAuth is disabled. |
| `ALCHEMY_HL_TRADE_KEY` | stdio mode | unset | Hot private key. Without it, write tools return "no signer configured". |
| `LOG_LEVEL` | no | `info` | `debug` / `info` / `warn` / `error`. |

## Stdio rule

MCP runs over JSON-RPC on stdio. The server uses stdout for protocol frames; **anything else written to stdout breaks the transport.** All logging goes to stderr (see `config.ts`). If you add logs, follow that convention.

## Troubleshooting

**Claude desktop doesn't see the tools after editing config:**
- The config path is exact — `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS. Verify it exists; create if not.
- Restart Claude desktop fully (Cmd+Q, not just close window).
- Check Claude desktop's logs (usually in `~/Library/Logs/Claude/`).

**Hosted connector won't connect / loops on auth:**
- `curl https://alchemy-hl-mcp.onrender.com/healthz` — `hasOauth` must be `true`.
- `OAUTH_SIGNING_SECRET` must be identical on the api and mcp services; a mismatch makes every token fail verification with a 401 `invalid_token`.
- Access tokens last 24h; expiry triggers a fresh OAuth handshake automatically.

**Tool call returns "no signer configured" (stdio):**
- Add `ALCHEMY_HL_TRADE_KEY` to the `env` block. Must be the 0x-prefixed private key, not the address.

**Trade returns "User does not exist":**
- The wallet hasn't deposited USDC into HL yet. Use the deposit flow on `/approve` or send USDC to the bridge on Arbitrum.

**Trade returns "Builder has insufficient balance":**
- Alchemy's builder wallet itself isn't funded (needs ≥ 100 USDC in HL perps). One-time ops setup — see the main repo README.
