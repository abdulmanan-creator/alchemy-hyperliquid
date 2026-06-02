# @alchemy-hl/mcp-server

MCP (Model Context Protocol) server for the Alchemy Hyperliquid trading API. Lets Claude desktop (and any other MCP-compatible host like Cursor, Continue, etc.) call our trading tools as functions.

## What this is

An MCP-compliant stdio server that exposes 9 tools:

| Tool | Auth needed | What Claude can do |
|---|---|---|
| `get_markets` | none | List perps + spot markets |
| `get_market_price` | none | Read current mid price for a symbol |
| `get_balance` | none | Read a wallet's HL perp balance |
| `get_open_orders` | none | List resting orders for a wallet |
| `get_approval` | none | Check builder-fee approval state |
| `place_market_order` | trading key | Buy/sell market (IOC) by notional or size |
| `place_limit_order` | trading key | Buy/sell limit with Gtc/Ioc/Alo |
| `cancel_order` | trading key | Cancel a resting order by oid |
| `approve_builder` | trading key | Sign approveBuilderFee (one-time setup or revoke) |

Without a trading key the connector is read-only (still useful for an "analyst" agent that proposes trades for human approval).

## Setup

### Prerequisites

1. The Alchemy Hyperliquid backend running somewhere (locally on `:8080`, or your deployed Render service).
2. A test wallet's private key. **Don't** use your personal MetaMask — generate a fresh one:
   ```bash
   cd packages/sdk && npx tsx scripts/generate-test-wallet.ts
   ```
   Fund it with ~$10 USDC + a tiny bit of ETH on Arbitrum, deposit USDC into HL, and approve our builder fee from it (via the SDK or `/approve` page).

### Install + build

```bash
cd packages/mcp-server
npm install                    # one-time
npm run build                  # produces dist/index.js
```

### Wire into Claude desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your OS:

```json
{
  "mcpServers": {
    "alchemy-hyperliquid": {
      "command": "node",
      "args": [
        "/absolute/path/to/Hyperliquid exchange support/packages/mcp-server/dist/index.js"
      ],
      "env": {
        "ALCHEMY_HL_API_URL": "http://localhost:8080",
        "ALCHEMY_HL_TRADE_KEY": "0x<your test wallet private key>"
      }
    }
  }
}
```

Restart Claude desktop. Open a new conversation. The connector tools should be available — try:

> What's the current BTC price on Hyperliquid?

Claude should call `get_market_price` and respond with the mid.

> Show me my Hyperliquid balance.

Calls `get_balance` (defaulting to the trading wallet).

> Buy $10 of BTC.

Calls `place_market_order`. Real trade against mainnet. Reports back the fill price + size + oid.

## Environment variables

| Var | Required | Default | Notes |
|---|---|---|---|
| `ALCHEMY_HL_API_URL` | no | `http://localhost:8080` | Where to send requests. Use your Render deployment for production. |
| `ALCHEMY_HL_TRADE_KEY` | no | unset | Hot private key for signing trades. Without it, write tools return "no signer configured" and the connector is read-only. |
| `LOG_LEVEL` | no | `info` | `debug` / `info` / `warn` / `error`. Logs go to stderr only. |

## Phase 1 vs Phase 2

This is the **Phase 1** signing model: one hot key, configured in env, all of Claude's trades signed by that key. Simple but means:

- The key holder must trust whoever runs the MCP process
- One key per server = one wallet per server (no multi-user isolation)
- Can't run this as a hosted service safely

**Phase 2 (HL API wallets / `approveAgent`)** replaces this with per-user delegated keys: each user signs a one-time `approveAgent` action authorizing a server-side key, and the server signs trades on their behalf within the authorized constraints. That's the model that makes this safe to deploy as a real hosted product. Roughly a week of work — see project plan in the main repo README.

## Stdio rule

MCP runs over JSON-RPC on stdio. The server uses stdout for protocol frames; **anything else written to stdout breaks the transport.** All logging goes to stderr (see `config.ts`). If you add logs, follow that convention.

## Troubleshooting

**Claude desktop doesn't see the tools after editing config:**
- The config path is exact — `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS. Verify it exists; create if not.
- Restart Claude desktop fully (Cmd+Q, not just close window).
- Check Claude desktop's logs (usually in `~/Library/Logs/Claude/`).

**Tool call returns "no signer configured":**
- Add `ALCHEMY_HL_TRADE_KEY` to the `env` block in `claude_desktop_config.json`. Must be the 0x-prefixed private key, not the address.

**Trade returns "User does not exist":**
- The trading wallet hasn't deposited USDC into HL yet. Send some USDC to the bridge contract on Arbitrum (see `packages/sdk/scripts/smoke-trade.ts` for a working example).

**Trade returns "Builder has insufficient balance":**
- Alchemy's builder wallet itself isn't funded. That's a one-time ops setup separate from the user's test wallet — see the main repo README.
