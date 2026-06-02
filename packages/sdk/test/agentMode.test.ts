/**
 * SDK agent-mode tests — agentJwt option routes trading through /agent/exchange.
 *
 * Mocked backend asserts:
 *   - trading methods call /agent/exchange with Authorization: Bearer <jwt>
 *   - the action body is sent unmodified (no signature, no nonce)
 *   - read-only methods still work without the jwt being interpreted as a signer
 *   - approveBuilder refuses agent mode (must come from user's primary wallet)
 *   - passing both privateKey and agentJwt throws SdkInputError
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey } from "viem/accounts";

import { Alchemy, SdkInputError } from "../src/index.js";

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

describe("agent mode", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes limitOrder through /agent/exchange with Authorization header", async () => {
    let calledUrl = "";
    let calledHeaders: Record<string, string> | undefined;
    let calledBody: unknown;
    fetchSpy.mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/markets")) return jsonRes(MARKETS);
      if (u.endsWith("/agent/exchange")) {
        calledUrl = u;
        calledHeaders = init?.headers as Record<string, string>;
        calledBody = JSON.parse((init?.body as string) ?? "{}");
        return jsonRes({
          success: true,
          user: "0xcccc000000000000000000000000000000000001",
          exchangeResponse: {
            status: "ok",
            response: { type: "order", data: { statuses: [{ filled: { totalSz: "0.001", avgPx: "60000", oid: 7 } }] } },
          },
        });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const sdk = new Alchemy({
      baseUrl: "http://localhost:8080",
      agentJwt: "fake-jwt-token",
    });

    const out = await sdk.limitOrder({
      symbol: "BTC",
      side: "buy",
      size: 0.001,
      price: 60000,
      tif: "Ioc",
    });

    expect(calledUrl).toContain("/agent/exchange");
    expect(calledHeaders?.authorization).toBe("Bearer fake-jwt-token");
    // Body is just { action } — no signature, no nonce (server fills both)
    expect(calledBody).toEqual({
      action: {
        type: "order",
        grouping: "na",
        orders: [{ a: 0, b: true, p: "60000", s: "0.001", r: false, t: { limit: { tif: "Ioc" } } }],
      },
    });
    expect(out.filled).toBe(true);
    expect(out.avgPrice).toBe("60000");
  });

  it("cancel uses /agent/exchange too in agent mode", async () => {
    let calledUrl = "";
    fetchSpy.mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/markets")) return jsonRes(MARKETS);
      if (u.endsWith("/agent/exchange")) {
        calledUrl = u;
        return jsonRes({
          success: true,
          user: "0xcccc000000000000000000000000000000000001",
          exchangeResponse: { status: "ok", response: { type: "cancel", data: { statuses: ["success"] } } },
        });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const sdk = new Alchemy({ baseUrl: "http://localhost:8080", agentJwt: "tok" });
    await sdk.cancel({ symbol: "BTC", oid: 42 });
    expect(calledUrl).toContain("/agent/exchange");
  });

  it("read-only methods work in agent mode (no signing involved)", async () => {
    fetchSpy.mockResolvedValueOnce(jsonRes(MARKETS));
    const sdk = new Alchemy({ baseUrl: "http://localhost:8080", agentJwt: "tok" });
    const m = await sdk.markets();
    expect(m.perps[0]?.name).toBe("BTC");
  });

  it("approveBuilder refuses in agent mode (user-key only)", async () => {
    const sdk = new Alchemy({ baseUrl: "http://localhost:8080", agentJwt: "tok" });
    await expect(sdk.approveBuilder({ maxFeeRate: "1%" })).rejects.toBeInstanceOf(SdkInputError);
  });

  it("throws when both privateKey and agentJwt are passed", () => {
    const pk = generatePrivateKey();
    expect(() =>
      new Alchemy({
        baseUrl: "http://localhost:8080",
        privateKey: pk,
        agentJwt: "tok",
      }),
    ).toThrow(SdkInputError);
  });
});
