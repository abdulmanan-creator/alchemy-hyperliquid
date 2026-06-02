/**
 * Read-only SDK smoke test. No signer, no key, no money at risk.
 *
 * Validates the SDK installs, imports cleanly, and successfully calls every
 * read-only endpoint on the local backend. Run with:
 *
 *   cd packages/sdk && npx tsx scripts/smoke-read.ts
 *
 * Requires the backend to be running locally (npm run dev from repo root).
 */

import { Alchemy } from "../src/index.js";

const EMBEDDED_WALLET = "0x4DA360cA0DA696ba4d56d94C3Ef2D4ba4f26cb43" as const;
const MAIN_BUILDER = "0x0cBACa5767bb23B47d7337B41E6aeADa7Da2C6B6" as const;

async function main() {
  const sdk = new Alchemy({ baseUrl: "http://localhost:8080" });

  console.log("→ sdk.markets()");
  const markets = await sdk.markets();
  console.log(`  ${markets.perps.length} perp markets, ${markets.spot.length} spot markets`);
  console.log(`  first 3 perps: ${markets.perps.slice(0, 3).map((p) => p.name).join(", ")}`);

  console.log("\n→ sdk.markPrice(0) (BTC)");
  const btc = await sdk.markPrice(0);
  console.log(`  ${btc.coin}: $${btc.mid}`);

  console.log("\n→ sdk.resolveAsset('BTC')");
  const asset = await sdk.resolveAsset("BTC");
  console.log(`  ${asset.symbol} → assetIndex ${asset.assetIndex}, szDecimals ${asset.szDecimals}`);

  console.log("\n→ sdk.balance(embedded wallet)");
  const userBal = await sdk.balance(EMBEDDED_WALLET);
  console.log(`  account value: $${userBal.accountValue}, open positions: ${userBal.openPositions}`);

  console.log("\n→ sdk.balance(MetaMask builder)");
  const builderBal = await sdk.balance(MAIN_BUILDER);
  console.log(`  account value: $${builderBal.accountValue}, open positions: ${builderBal.openPositions}`);

  console.log("\n→ sdk.approval(embedded wallet)");
  const approval = await sdk.approval(EMBEDDED_WALLET);
  console.log(`  approved: ${approval.approved}, max fee rate: ${approval.maxFeeRate}`);

  console.log("\n✓ All read-only methods OK");
}

main().catch((err) => {
  console.error("✗ Failed:", err);
  process.exit(1);
});
