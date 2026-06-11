import { defineConfig } from "vitest/config";

/**
 * Integration suite — hits the real Hyperliquid TESTNET over the network.
 * Kept out of the default `npm test` glob so unit CI stays hermetic.
 * Run with: npm run test:integration
 */
export default defineConfig({
  test: {
    include: ["test-integration/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Network tests against one shared HL account must not interleave.
    fileParallelism: false,
  },
});
