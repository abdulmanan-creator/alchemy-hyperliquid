import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("config", () => {
  it("loads valid env", () => {
    const cfg = loadConfig({
      ALCHEMY_BUILDER_ADDRESS: "0x1234567890123456789012345678901234567890",
      HYPERLIQUID_API_URL: "https://api.hyperliquid.xyz",
      PERPS_BUILDER_FEE_BPS: "4",
      SPOT_BUILDER_FEE_BPS: "5",
    } as NodeJS.ProcessEnv);
    expect(cfg.PERPS_BUILDER_FEE_BPS).toBe(4);
    expect(cfg.builderAddressLower).toBe("0x1234567890123456789012345678901234567890");
    expect(cfg.isTestnet).toBe(false);
  });

  it("rejects a perps fee above protocol max", () => {
    expect(() =>
      loadConfig({
        ALCHEMY_BUILDER_ADDRESS: "0x1234567890123456789012345678901234567890",
        HYPERLIQUID_API_URL: "https://api.hyperliquid.xyz",
        PERPS_BUILDER_FEE_BPS: "11",
        SPOT_BUILDER_FEE_BPS: "5",
      } as NodeJS.ProcessEnv),
    ).toThrow(/PERPS_BUILDER_FEE_BPS/);
  });

  it("detects testnet from the url", () => {
    const cfg = loadConfig({
      ALCHEMY_BUILDER_ADDRESS: "0x1234567890123456789012345678901234567890",
      HYPERLIQUID_API_URL: "https://api.hyperliquid-testnet.xyz",
      PERPS_BUILDER_FEE_BPS: "4",
      SPOT_BUILDER_FEE_BPS: "5",
    } as NodeJS.ProcessEnv);
    expect(cfg.isTestnet).toBe(true);
  });
});
