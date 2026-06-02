/**
 * Full SDK trade smoke test. Uses a test wallet (see generate-test-wallet.ts)
 * to: check approval, approve if needed, place a small market buy, close.
 *
 *   cd packages/sdk && npx tsx scripts/smoke-trade.ts
 *
 * Requires the backend running locally + TEST_WALLET_PK in repo-root .env.
 */

import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { Alchemy, AlchemyHlError } from "../src/index.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const PK = process.env.TEST_WALLET_PK as `0x${string}` | undefined;
if (!PK) {
  console.error("Missing TEST_WALLET_PK in .env. Run generate-test-wallet.ts first.");
  process.exit(1);
}

const sdk = new Alchemy({ privateKey: PK, baseUrl: "http://localhost:8080" });

async function main() {
  console.log("→ Checking approval state…");
  const a = await sdk.approval();
  if (!a.approved) {
    console.log("  Not approved. Signing approveBuilderFee at 1%…");
    const r = await sdk.approveBuilder({ maxFeeRate: "1%" });
    console.log(`  Approve result: success=${r.success}`);
  } else {
    console.log(`  Approved at ${a.maxFeeRate} ✓`);
  }

  console.log("\n→ Reading wallet balance…");
  const bal = await sdk.balance();
  console.log(`  account value: $${bal.accountValue}, open positions: ${bal.openPositions}`);

  console.log("\n→ Market buy ~$11 of BTC (IOC)…");
  const buy = await sdk.marketBuy("BTC", { notional: 11 });
  if (buy.error) {
    console.error(`  ✗ Order rejected: ${buy.error}`);
    process.exit(1);
  }
  if (!buy.filled) {
    console.error("  ✗ Order did not fill (resting? — IOC shouldn't rest)");
    process.exit(1);
  }
  console.log(`  ✓ Filled ${buy.filledSize} BTC @ $${buy.avgPrice} (oid ${buy.oid})`);

  console.log("\n→ Market sell to close (reduce-only)…");
  const sell = await sdk.marketSell("BTC", {
    size: buy.filledSize,
    reduceOnly: true,
  });
  if (sell.error) {
    console.error(`  ✗ Close rejected: ${sell.error}`);
    process.exit(1);
  }
  console.log(`  ✓ Closed ${sell.filledSize} BTC @ $${sell.avgPrice} (oid ${sell.oid})`);

  console.log("\n→ Final balance…");
  const final = await sdk.balance();
  console.log(`  account value: $${final.accountValue}, open positions: ${final.openPositions}`);

  console.log("\n✓ Round trip done. SDK is wired end-to-end.");
}

main().catch((err) => {
  if (err instanceof AlchemyHlError) {
    console.error(`✗ AlchemyHlError [${err.code}]: ${err.message}`);
    console.error(`  Guidance: ${err.guidance}`);
  } else {
    console.error("✗ Failed:", err);
  }
  process.exit(1);
});
