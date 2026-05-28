# Alchemy Hyperliquid

A zero-custody REST builder API for trading on Hyperliquid. The user's private key never leaves their machine — our backend builds the action, the client signs it locally, and we forward the signed payload to Hyperliquid's `/exchange` endpoint with Alchemy's builder code attached. We earn the builder fee on every routed trade.

## Repo layout

```
apps/
  api/          Fastify + TypeScript backend
  web/          Next.js 14 site (landing + docs + /approve)
packages/
  shared/       Shared TypeScript types
  sdk-preview/  Thin typed fetch client (preview, no signing)
render.yaml     Render deploy config (two services)
.env.example    Documented environment variables
```

## Prerequisites

1. **Node 20+** and **npm 10+**.
2. **An Alchemy builder wallet** — a Hyperliquid account funded with ≥ 100 USDC in perps, running in standard (non-account-abstraction) mode. This is the wallet that earns the builder fee. Put its address in `ALCHEMY_BUILDER_ADDRESS`.
3. **A WalletConnect Cloud project ID** for the wallet-connect flow on `/approve`. Get one at https://cloud.walletconnect.com.

## Local dev

```bash
cp .env.example .env
# edit .env with your builder address + WC project id
npm install
npm run dev
```

This boots:
- `apps/web` at http://localhost:3000
- `apps/api` at http://localhost:8080

## Tests

```bash
npm test
```

Unit tests live under `apps/api/test/` (vitest). They cover builder-fee injection, signature recovery for L1 and EIP-712 actions, cap enforcement, and a mocked build→send roundtrip.

## Deploying to Render

1. Push this repo to GitHub.
2. In Render: **New → Blueprint** → point at the repo. Render reads `render.yaml` and creates both services.
3. In each service's **Environment** tab, fill in the `sync: false` secrets:
   - `alchemy-hl-api`: `ALCHEMY_BUILDER_ADDRESS`
   - `alchemy-hl-web`: `NEXT_PUBLIC_BUILDER_ADDR`, `WALLETCONNECT_PROJECT_ID`
4. Deploy.

## Bumping the fee config without a redeploy

The fee BPS values are read from env, so you can update them in the Render service's Environment tab and restart — no code change, no redeploy. Hard caps (`MAX_BUILDER_FEE_BPS_*`) exist in env too but the protocol enforces its own ceilings (10 bps perps, 100 bps spot), so raising ours above those won't help.

## Status

Scaffold in place. Endpoints land next — see the project plan in the conversation.
