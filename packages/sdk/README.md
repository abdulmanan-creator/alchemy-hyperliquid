# @alchemy-hl/sdk

Zero-custody TypeScript SDK for trading on Hyperliquid through Alchemy's builder API. Your private key signs locally (or in your user's wallet) — Alchemy's backend shapes the order, injects the builder code, and forwards your signed payload to Hyperliquid. Keys never transit the server.

```ts
import { Alchemy } from "@alchemy-hl/sdk";

const sdk = new Alchemy({
  privateKey: process.env.PK as `0x${string}`,
  baseUrl: "https://alchemy-hl-api.onrender.com",
});

await sdk.approveBuilder({ maxFeeRate: "1%" });          // once per wallet
const order = await sdk.marketBuy("BTC", { notional: 100 });
console.log(`Filled ${order.filledSize} @ $${order.avgPrice}`);
```

## Signing modes

| Mode | Config | Use case |
|---|---|---|
| Hot key | `{ privateKey: "0x…" }` | Bots, scripts, server-side agents |
| External wallet | `{ account, signTypedDataAsync }` | Browser dApps (Privy, MetaMask, wagmi) |
| Agent JWT | `{ agentJwt: "<token>" }` | Hosted AI connectors — backend signs with a per-user, trade-only delegated key |

Pass exactly one. In agent mode the user must have signed `approveAgent` once (the hosted OAuth flow does this); the agent key can trade but can never withdraw — enforced by the Hyperliquid protocol.

## Trading

```ts
await sdk.limitOrder({ symbol: "ETH", side: "sell", size: 0.5, price: 4200, tif: "Alo" });
await sdk.marketBuy("BTC", { notional: 250 });            // by USD notional
await sdk.marketSell("BTC", { size: 0.002 });             // by base size
await sdk.cancel({ symbol: "BTC", oid: 123456 });
await sdk.setLeverage("BTC", 5, "isolated");
```

### Positions, TP/SL, closing

```ts
const { positions } = await sdk.positions();              // live PnL per position
await sdk.takeProfit("BTC", { triggerPrice: 120_000 });   // closes the position at +target
await sdk.stopLoss("BTC", { triggerPrice: 85_000 });      // protects the downside
await sdk.closePosition("BTC");                           // flatten now (reduce-only market)
await sdk.closePosition("BTC", { size: 0.001 });          // partial close
```

`takeProfit` / `stopLoss` are reduce-only by default and derive direction + size from the open position; pass `side` / `size` to override. Trigger orders rest until the mark price crosses `triggerPrice` — cancel them like any order via the returned `restingOid`.

### Reads

```ts
await sdk.markets();           // perps + spot universe with precision metadata
await sdk.markPrice(0);        // live mid by asset index
await sdk.balance();           // account value, withdrawable, margin used
await sdk.openOrders();        // resting orders w/ ready-made cancel actions
await sdk.userFills();         // recent executions w/ fees + closed PnL
await sdk.approval();          // builder-fee approval state
```

All reads accept an explicit `user` address to inspect any wallet (HL state is public).

## Retries without double-trades (agent mode)

Trading methods accept an `idempotencyKey`. On the agent path, retrying with the same key replays the original response instead of placing a second order:

```ts
await sdk.marketBuy("BTC", { notional: 100, idempotencyKey: crypto.randomUUID() });
```

On the user-signed path this isn't needed — the signature itself dedupes (the backend rejects a resubmitted signed payload with `DUPLICATE_REQUEST`).

## Errors

Backend rejections throw `AlchemyHlError` with `{ code, message, guidance, httpStatus }` — `guidance` is human-readable "what to do about it" text. Local validation problems throw `SdkInputError`. Both are exported.

Precision is handled for you: prices and sizes are rounded to each asset's `szDecimals` and HL's 5-significant-figure price rule before submission, mirroring HL's own Python SDK semantics.

## Publishing checklist (maintainers)

The package is currently `"private": true`. To publish:

1. Publish `@alchemy-hl/shared` first (it's a runtime dependency), or inline it.
2. Replace the `"*"` workspace dependency with a real semver range.
3. Flip `"private": false`, set the version, `npm publish --access public` from a clean build (`npm run clean && npm run build`).
