/**
 * Phase 4 SDK surface — trigger orders (TP/SL), closePosition, positions/
 * fills reads, and idempotencyKey plumbing on the agent path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Alchemy, SdkInputError, buildTriggerOrder } from "../src/index.js";

const USER = "0xcccc000000000000000000000000000000000001" as const;
const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const; // well-known test key

const MARKETS = {
  perps: [{ name: "BTC", szDecimals: 5, maxLeverage: 40, assetIndex: 0 }],
  spot: [],
  hip3: [],
  hip4: [],
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("buildTriggerOrder", () => {
  it("builds a reduce-only market TP leg with a default fill bound", () => {
    const action = buildTriggerOrder({
      assetIndex: 0,
      szDecimals: 5,
      side: "sell",
      size: 0.5,
      triggerPrice: 120000,
      tpsl: "tp",
    });
    const leg = action.orders[0]!;
    expect(leg.a).toBe(0);
    expect(leg.b).toBe(false);
    expect(leg.r).toBe(true); // reduce-only by default
    expect(leg.t).toEqual({
      trigger: { isMarket: true, triggerPx: "120000", tpsl: "tp" },
    });
    // Default bound: sell → trigger * 0.9, rounded to 5 sig figs.
    expect(Number(leg.p)).toBeCloseTo(108000, 0);
  });

  it("requires limitPrice when isMarket=false", () => {
    expect(() =>
      buildTriggerOrder({
        assetIndex: 0,
        szDecimals: 5,
        side: "buy",
        size: 1,
        triggerPrice: 50000,
        tpsl: "sl",
        isMarket: false,
      }),
    ).toThrow(SdkInputError);
  });

  it("honors explicit reduceOnly=false and limitPrice", () => {
    const action = buildTriggerOrder({
      assetIndex: 0,
      szDecimals: 5,
      side: "buy",
      size: 1,
      triggerPrice: 50000,
      tpsl: "sl",
      isMarket: false,
      limitPrice: 50500,
      reduceOnly: false,
    });
    const leg = action.orders[0]!;
    expect(leg.r).toBe(false);
    expect(leg.p).toBe("50500");
    expect(leg.t).toEqual({
      trigger: { isMarket: false, triggerPx: "50000", tpsl: "sl" },
    });
  });
});

describe("closePosition / takeProfit / stopLoss / reads", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const sent: Array<{ url: string; body: unknown }> = [];

  const POSITIONS = {
    user: USER,
    positions: [
      {
        coin: "BTC",
        size: "0.5",
        side: "long",
        entryPx: "97000",
        positionValue: "48500",
        unrealizedPnl: "100",
        returnOnEquity: "0.02",
        liquidationPx: "60000",
        leverage: 10,
        leverageMode: "cross",
      },
    ],
  };

  beforeEach(() => {
    sent.length = 0;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("/markets")) return jsonRes(MARKETS);
      if (u.includes("/positions")) return jsonRes(POSITIONS);
      if (u.includes("/userFills")) return jsonRes({ user: USER, fills: [{ coin: "BTC", px: "97000", sz: "0.1", side: "B", time: 1, oid: 1 }] });
      if (u.includes("/markPrice")) return jsonRes({ asset: 0, coin: "BTC", mid: "100000" });
      if (u.endsWith("/agent/exchange")) {
        sent.push({ url: u, body: JSON.parse((init?.body as string) ?? "{}") });
        return jsonRes({
          success: true,
          user: USER,
          exchangeResponse: {
            status: "ok",
            response: { type: "order", data: { statuses: [{ filled: { totalSz: "0.5", avgPx: "100000", oid: 9 } }] } },
          },
        });
      }
      if (u.endsWith("/exchange")) {
        const body = JSON.parse((init?.body as string) ?? "{}") as { signature?: unknown; action?: unknown };
        sent.push({ url: u, body });
        if (!body.signature) {
          // Build phase: echo a minimal envelope the signer can sign.
          return jsonRes({
            hash: "0x" + "ab".repeat(32),
            nonce: 1,
            action: body.action,
            isSpot: false,
            builderFee: 40,
            builder: "0x" + "aa".repeat(20),
            typedData: {
              domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: "0x0000000000000000000000000000000000000000" },
              types: { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] },
              primaryType: "Agent",
              message: { source: "a", connectionId: "0x" + "ab".repeat(32) },
            },
          });
        }
        return jsonRes({
          success: true,
          user: USER,
          exchangeResponse: {
            status: "ok",
            response: { type: "order", data: { statuses: [{ resting: { oid: 11 } }] } },
          },
        });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("positions() and userFills() return typed reads", async () => {
    const sdk = new Alchemy({ baseUrl: "http://x", privateKey: PK });
    const pos = await sdk.positions(USER);
    expect(pos.positions[0]!.coin).toBe("BTC");
    const fills = await sdk.userFills(USER, 5);
    expect(fills.fills).toHaveLength(1);
  });

  it("closePosition sells the full long reduce-only as market IOC", async () => {
    const sdk = new Alchemy({ baseUrl: "http://x", agentJwt: header(USER) });
    const result = await sdk.closePosition("BTC");
    expect(result.filled).toBe(true);
    const order = sent.find((s) => s.url.endsWith("/agent/exchange"))!.body as {
      action: { orders: Array<{ b: boolean; r: boolean; s: string; t: unknown }> };
    };
    const leg = order.action.orders[0]!;
    expect(leg.b).toBe(false); // closing a long = sell
    expect(leg.r).toBe(true);
    expect(leg.s).toBe("0.5"); // full position size
    expect(leg.t).toEqual({ limit: { tif: "Ioc" } });
  });

  it("closePosition throws when there is no position", async () => {
    const sdk = new Alchemy({ baseUrl: "http://x", agentJwt: header(USER) });
    await expect(sdk.closePosition("ETH")).rejects.toThrow(SdkInputError);
  });

  it("takeProfit derives closing side + size from the open position", async () => {
    const sdk = new Alchemy({ baseUrl: "http://x", agentJwt: header(USER) });
    await sdk.takeProfit("BTC", { triggerPrice: 120000 });
    const order = sent.find((s) => s.url.endsWith("/agent/exchange"))!.body as {
      action: { orders: Array<{ b: boolean; r: boolean; s: string; t: { trigger?: { tpsl: string; triggerPx: string } } }> };
    };
    const leg = order.action.orders[0]!;
    expect(leg.b).toBe(false); // long → tp sells
    expect(leg.s).toBe("0.5");
    expect(leg.t.trigger).toMatchObject({ tpsl: "tp", triggerPx: "120000" });
  });

  it("stopLoss works on the user-signed path too (build → sign → send)", async () => {
    const sdk = new Alchemy({ baseUrl: "http://x", privateKey: PK });
    // Explicit side+size so it doesn't need a position lookup keyed to PK's address.
    const result = await sdk.stopLoss("BTC", {
      triggerPrice: 85000,
      side: "sell",
      size: 0.25,
    });
    expect(result.restingOid).toBe(11);
    const send = sent.filter((s) => s.url.endsWith("/exchange")).at(-1)!.body as {
      signature: unknown;
      action: { orders: Array<{ t: { trigger?: { tpsl: string } } }> };
    };
    expect(send.signature).toBeDefined();
    expect(send.action.orders[0]!.t.trigger?.tpsl).toBe("sl");
  });

  it("threads idempotencyKey into the agent-path body", async () => {
    const sdk = new Alchemy({ baseUrl: "http://x", agentJwt: header(USER) });
    await sdk.marketBuy("BTC", { size: 0.1, idempotencyKey: "buy-1" });
    const body = sent.find((s) => s.url.endsWith("/agent/exchange"))!.body as {
      idempotencyKey?: string;
    };
    expect(body.idempotencyKey).toBe("buy-1");
  });
});

/** Minimal unsigned JWT with the user's address in `sub` (decode-only use). */
function header(sub: string): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ sub })}.sig`;
}
