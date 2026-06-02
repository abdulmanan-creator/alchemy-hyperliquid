/**
 * Generate a fresh wallet for SDK testing. Run once, save the output
 * somewhere safe (NOT committed to git), use the private key for SDK scripts.
 *
 * Cost to fund this wallet for full SDK testing on mainnet:
 *   ~$10 USDC (deposit to HL — covers test trades)
 *   ~$1 ETH on Arbitrum (gas for the deposit transaction itself)
 *
 * Run:
 *   cd packages/sdk && npx tsx scripts/generate-test-wallet.ts
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);

console.log("Generated test wallet:");
console.log(`  Address:     ${account.address}`);
console.log(`  Private key: ${pk}`);
console.log("");
console.log("Funding steps:");
console.log("  1. Send ~$10 USDC + ~$1 ETH (Arbitrum One) to the address above");
console.log("  2. Deposit USDC into HL: from any browser with that wallet,");
console.log("     or via Arbiscan write-contract to USDC.transfer(0x2Df1c51E..., 10000000)");
console.log("  3. Save the private key as TEST_WALLET_PK in your .env (gitignored)");
console.log("  4. Run smoke-trade.ts to test the full trading flow");
