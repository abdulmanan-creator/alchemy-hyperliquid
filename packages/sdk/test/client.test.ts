/**
 * Client integration tests against a mocked backend.
 *
 * Mocks the global fetch to simulate /markets, /balance, /approval, and
 * /exchange (both build and send phases). Verifies the SDK:
 *   - Resolves symbols via the asset cache
 *   - Posts the right body to /exchange build (action only, no signature)
 *   - Signs the returned typed data with the hot-key signer
 *   - Posts the signed payload to /exchange send with normalized v
 *   - Returns the parsed SendResponse
 *
 * Tests run with vitest's spyOn(globalThis, "fetch").
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { Alchemy } from "../src/index.js";
import { AlchemyHlError, SdkInputError } from "../src/errors.js";

const MARKETS_RESPONSE = {
  perps: [
    { name: "BTC", szDecimals: 5, maxLeverage: 40, assetIndex: 0 },
    { name: "ETH", szDecimals: 4, maxLeverage: 25, assetIndex: 1 },
  ],
  spot: [],
  hip3: [],
  hip4: [],
};

const TYPED_DATA = {
  domain: {
    name: "Exchange",
    version: "1",
    chainId: 1337,
    verifyingContract: "0x0000000000000000000000000000000000000000",
  },
  types: { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] },
  primaryType: "Agent",
  message: { source: "a", connectionId: "0x" + "ab".repeat(32) },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buildResponseFor(action: unknown) {
  return jsonResponse({
    hash: "0x" + "11".repeat(32),
    nonce: 1234567890,
    action,
    isSpot: false,
    builderFee: 4,
    builder: "0x0000000000000000000000000000000000000001",
    typedData: TYPED_DATA,
  });
}

describe("Alchemy client", () => {
  let pk: `0x${string}`;
  let account: ReturnType<typeof privateKeyToAccount>;
  let sdk: Alchemy;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    pk = generatePrivateKey();
    account = privateKeyToAccount(pk);
    sdk = new Alchemy({
      privateKey: pk,
      baseUrl: "http://localhost:8080",
    });
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("limitOrder: resolves symbol, signs, posts to send", async () => {
    let buildBody: unknown;
    let sendBody: unknown;
    fetchSpy.mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/markets")) return jsonResponse(MARKETS_RESPONSE);
      if (u.endsWith("/exchange") && init?.method === "POST") {
        const body = JSON.parse((init.body as string) ?? "{}");
        if (body.signature) {
          sendBody = body;
          return jsonResponse({
            success: true,
            user: account.address,
            exchangeResponse: { status: "ok", response: { type: "order", data: { statuses: [{ resting: { oid: 1 } }] } } },
          });
        }
        buildBody = body;
        return buildResponseFor(body.action);
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const out = await sdk.limitOrder({
      symbol: "BTC",
      side: "buy",
      size: 0.001,
      price: 60000,
    });

    // Build phase request shape
    expect(buildBody).toEqual({
      action: {
        type: "order",
        grouping: "na",
        orders: [{ a: 0, b: true, p: "60000", s: "0.001", r: false, t: { limit: { tif: "Gtc" } } }],
      },
    });

    // Send phase request shape — signature should be {r,s,v} with v=27/28
    expect(sendBody).toMatchObject({
      action: { type: "order" },
      nonce: 1234567890,
      signature: {
        r: expect.stringMatching(/^0x[0-9a-f]{64}$/),
        s: expect.stringMatching(/^0x[0-9a-f]{64}$/),
        v: expect.any(Number),
      },
    });
    const v = (sendBody as { signature: { v: number } }).signature.v;
    expect(v === 27 || v === 28).toBe(true);

    // OrderResult shape: restingOid since we mocked a resting limit fill
    expect(out.user).toBe(account.address);
    expect(out.restingOid).toBe(1);
    expect(out.filled).toBe(false);
  });

  it("OrderResult exposes filledSize/avgPrice/oid on a filled IOC", async () => {
    fetchSpy.mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/markets")) return jsonResponse(MARKETS_RESPONSE);
      if (u.endsWith("/exchange") && init?.method === "POST") {
        const body = JSON.parse((init.body as string) ?? "{}");
        if (body.signature) {
          return jsonResponse({
            success: true,
            user: account.address,
            exchangeResponse: {
              status: "ok",
              response: {
                type: "order",
                data: {
                  statuses: [{ filled: { totalSz: "0.0002", avgPx: "70735.1", oid: 99 } }],
                },
              },
            },
          });
        }
        return buildResponseFor(body.action);
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const out = await sdk.limitOrder({
      symbol: "BTC",
      side: "buy",
      size: 0.0002,
      price: 200000,
      tif: "Ioc",
    });
    expect(out.filled).toBe(true);
    expect(out.filledSize).toBe("0.0002");
    expect(out.avgPrice).toBe("70735.1");
    expect(out.oid).toBe(99);
    expect(out.raw.success).toBe(true);
  });

  it("OrderResult surfaces matcher-level errors on .error", async () => {
    fetchSpy.mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/markets")) return jsonResponse(MARKETS_RESPONSE);
      if (u.endsWith("/exchange") && init?.method === "POST") {
        const body = JSON.parse((init.body as string) ?? "{}");
        if (body.signature) {
          return jsonResponse({
            success: true,
            user: account.address,
            exchangeResponse: {
              status: "ok",
              response: {
                type: "order",
                data: {
                  statuses: [{ error: "Order must have minimum value of $10. asset=0" }],
                },
              },
            },
          });
        }
        return buildResponseFor(body.action);
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const out = await sdk.limitOrder({
      symbol: "BTC",
      side: "buy",
      size: 0.00001,
      price: 200000,
      tif: "Ioc",
    });
    expect(out.filled).toBe(false);
    expect(out.error).toMatch(/minimum value/);
    expect(out.raw.success).toBe(true);
  });

  it("marketBuy with notional fetches markPrice automatically", async () => {
    let lastBuildBody: { action?: { orders?: { s: string }[] } } | null = null;
    fetchSpy.mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/markets")) return jsonResponse(MARKETS_RESPONSE);
      if (u.includes("/markPrice")) return jsonResponse({ asset: 0, coin: "BTC", mid: "50000" });
      if (u.endsWith("/exchange") && init?.method === "POST") {
        const body = JSON.parse((init.body as string) ?? "{}");
        if (body.signature) {
          return jsonResponse({
            success: true,
            user: account.address,
            exchangeResponse: { status: "ok", response: { type: "order" } },
          });
        }
        lastBuildBody = body;
        return buildResponseFor(body.action);
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    await sdk.marketBuy("BTC", { notional: 100 });

    // 100 / 50000 = 0.002 BTC
    expect(lastBuildBody?.action?.orders?.[0]?.s).toBe("0.002");
  });

  it("approveBuilder posts a user-signed action", async () => {
    let buildBody: { action?: { type?: string; maxFeeRate?: string } } | null = null;
    fetchSpy.mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/exchange") && init?.method === "POST") {
        const body = JSON.parse((init.body as string) ?? "{}");
        if (body.signature) {
          return jsonResponse({
            success: true,
            user: account.address,
            exchangeResponse: { status: "ok", response: { type: "default" } },
          });
        }
        buildBody = body;
        return buildResponseFor({ type: "approveBuilderFee", maxFeeRate: "1%" });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const out = await sdk.approveBuilder({ maxFeeRate: "1%" });
    expect(buildBody?.action?.type).toBe("approveBuilderFee");
    expect(buildBody?.action?.maxFeeRate).toBe("1%");
    expect(out.success).toBe(true);
  });

  it("balance() defaults to signer address", async () => {
    let path = "";
    fetchSpy.mockImplementation(async (url) => {
      path = String(url);
      return jsonResponse({
        user: account.address,
        accountValue: "100.0",
        withdrawable: "100.0",
        marginUsed: "0.0",
        openPositions: 0,
      });
    });

    await sdk.balance();
    expect(path).toContain(`/balance?user=${encodeURIComponent(account.address)}`);
  });

  it("read-only calls work without a signer", async () => {
    const noSignerSdk = new Alchemy({ baseUrl: "http://localhost:8080" });
    fetchSpy.mockResolvedValueOnce(jsonResponse(MARKETS_RESPONSE));
    const m = await noSignerSdk.markets();
    expect(m.perps).toHaveLength(2);
  });

  it("trading calls without a signer throw SdkInputError", async () => {
    const noSignerSdk = new Alchemy({ baseUrl: "http://localhost:8080" });
    fetchSpy.mockResolvedValue(jsonResponse(MARKETS_RESPONSE));
    await expect(
      noSignerSdk.limitOrder({ symbol: "BTC", side: "buy", size: 0.001, price: 60000 }),
    ).rejects.toBeInstanceOf(SdkInputError);
  });

  it("backend errors become typed AlchemyHlError", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(MARKETS_RESPONSE));
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        {
          error: "NEEDS_DEPOSIT",
          message: "Must deposit before performing actions.",
          guidance: "Deposit USDC at https://app.hyperliquid.xyz/portfolio",
        },
        422,
      ),
    );

    try {
      await sdk.limitOrder({ symbol: "BTC", side: "buy", size: 0.001, price: 60000 });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AlchemyHlError);
      const ahl = err as AlchemyHlError;
      expect(ahl.code).toBe("NEEDS_DEPOSIT");
      expect(ahl.httpStatus).toBe(422);
      expect(ahl.guidance).toContain("hyperliquid.xyz");
    }
  });

  it("unknown symbol throws SdkInputError before any signing", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(MARKETS_RESPONSE));
    await expect(
      sdk.limitOrder({ symbol: "DOGE", side: "buy", size: 1, price: 0.1 }),
    ).rejects.toBeInstanceOf(SdkInputError);
  });
});
