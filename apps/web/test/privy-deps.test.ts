/**
 * Privy provider boot-path smoke test.
 *
 * We don't actually mount providers.tsx here — it's a "use client" React
 * component that wants a browser. Instead we verify that all the Privy
 * imports the providers + /approve page rely on actually resolve from this
 * workspace, and that the expected named exports exist with the right shape.
 *
 * If Privy ever renames or removes one of these exports in a minor bump,
 * this test fails before `next build` does.
 *
 * Per the user's brief: "no-op assertion, just ensures the module imports
 * cleanly."
 */

import { describe, expect, it } from "vitest";

describe("privy provider boot path", () => {
  it("@privy-io/react-auth ships the hooks /approve uses", async () => {
    const mod = await import("@privy-io/react-auth");
    expect(mod.PrivyProvider).toBeTypeOf("function");
    expect(mod.usePrivy).toBeTypeOf("function");
    expect(mod.useWallets).toBeTypeOf("function");
    expect(mod.useFundWallet).toBeTypeOf("function");
  });

  it("@privy-io/wagmi ships WagmiProvider + createConfig", async () => {
    const mod = await import("@privy-io/wagmi");
    expect(mod.WagmiProvider).toBeTypeOf("function");
    expect(mod.createConfig).toBeTypeOf("function");
  });

  it("wagmi ships useSignTypedData (used through Privy's connector)", async () => {
    const mod = await import("wagmi");
    expect(mod.useSignTypedData).toBeTypeOf("function");
  });
});
