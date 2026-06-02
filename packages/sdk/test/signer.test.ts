import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { makeSigner, normalizeHexSig } from "../src/signer.js";

describe("normalizeHexSig", () => {
  it("preserves v=27/28 untouched", () => {
    const r = "a".repeat(64);
    const s = "b".repeat(64);
    const hex = `0x${r}${s}1b` as `0x${string}`;
    expect(normalizeHexSig(hex).v).toBe(27);
  });

  it("bumps v=0 → 27 and v=1 → 28", () => {
    const r = "a".repeat(64);
    const s = "b".repeat(64);
    expect(normalizeHexSig(`0x${r}${s}00` as `0x${string}`).v).toBe(27);
    expect(normalizeHexSig(`0x${r}${s}01` as `0x${string}`).v).toBe(28);
  });

  it("splits r and s correctly", () => {
    const r = "1".repeat(64);
    const s = "2".repeat(64);
    const out = normalizeHexSig(`0x${r}${s}1c` as `0x${string}`);
    expect(out.r).toBe(`0x${r}`);
    expect(out.s).toBe(`0x${s}`);
    expect(out.v).toBe(28);
  });

  it("rejects malformed signatures", () => {
    expect(() => normalizeHexSig("0xdeadbeef" as `0x${string}`)).toThrow(/length/);
  });
});

describe("makeSigner", () => {
  it("hot-key path signs typed data with the right address", async () => {
    const pk = generatePrivateKey();
    const expected = privateKeyToAccount(pk);
    const signer = makeSigner({ privateKey: pk });
    expect(signer.address).toBe(expected.address);

    const sig = await signer.signTypedData({
      domain: { name: "Test", version: "1", chainId: 1, verifyingContract: "0x0000000000000000000000000000000000000000" },
      types: { Foo: [{ name: "x", type: "uint256" }] },
      primaryType: "Foo",
      message: { x: 42n },
    });
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("external signer path delegates to the provided fn", async () => {
    let called = false;
    const signer = makeSigner({
      account: "0x1234567890123456789012345678901234567890",
      signTypedDataAsync: async () => {
        called = true;
        return "0x" + "00".repeat(65) as `0x${string}`;
      },
    });
    expect(signer.address).toBe("0x1234567890123456789012345678901234567890");
    await signer.signTypedData({
      domain: { name: "X", version: "1", chainId: 1, verifyingContract: "0x0000000000000000000000000000000000000000" },
      types: { Y: [{ name: "z", type: "string" }] },
      primaryType: "Y",
      message: { z: "hi" },
    });
    expect(called).toBe(true);
  });

  it("rejects bad input early", () => {
    expect(() => makeSigner({ privateKey: "not-hex" as `0x${string}` })).toThrow();
    expect(() =>
      // @ts-expect-error missing account
      makeSigner({ signTypedDataAsync: async () => "0x" as `0x${string}` }),
    ).toThrow();
  });
});
