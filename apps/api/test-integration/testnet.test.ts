/**
 * Integration tests against the real Hyperliquid TESTNET.
 *
 * Two tiers:
 *
 *   1. Read + build (always run): real /info queries, build-phase payloads,
 *      preflight. Proves our wire shapes still match HL's current API —
 *      the thing unit-test mocks can silently drift from.
 *
 *   2. Signed roundtrip (env-gated): approveBuilderFee → place a resting
 *      limit order far from the market → verify via /openOrders → cancel.
 *      Needs a funded testnet wallet:
 *
 *        HL_TESTNET_PRIVATE_KEY  0x-prefixed key of a wallet that has
 *                                deposited USDC on https://app.hyperliquid-testnet.xyz
 *                                (faucet: /drip). Never use a mainnet key.
 *
 *      The configured ALCHEMY_BUILDER_ADDRESS must also have a funded
 *      *testnet* account or approveBuilderFee fails — that's an HL rule
 *      (both sides of a builder relationship must exist on-chain).
 *
 * Run: npm run test:integration   (from apps/api)
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import type { BuildResponse, MarketsResponse, SendResponse } from "@alchemy-hl/shared";

import { loadConfig } from "../src/config.js";
import { ApiException, sendError } from "../src/errors.js";
import { registerRoutes } from "../src/routes/index.js";

// Pull the repo-root .env so ALCHEMY_BUILDER_ADDRESS etc. are available, then
// force the HL URL to testnet regardless of what .env points at.
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env");
if (existsSync(envPath)) dotenv.config({ path: envPath });

const TESTNET_URL = "https://api.hyperliquid-testnet.xyz";
const PK = process.env.HL_TESTNET_PRIVATE_KEY as `0x${string}` | undefined;

async function buildApp(): Promise<FastifyInstance> {
  const cfg = loadConfig({
    ...process.env,
    HYPERLIQUID_API_URL: TESTNET_URL,
    // A real-looking builder is required by config validation even for the
    // read-only tier; the signed tier needs the real (testnet-funded) one.
    ALCHEMY_BUILDER_ADDRESS:
      process.env.ALCHEMY_BUILDER_ADDRESS ?? "0xAAAA000000000000000000000000000000000001",
    PERPS_BUILDER_FEE_BPS: process.env.PERPS_BUILDER_FEE_BPS ?? "4",
    SPOT_BUILDER_FEE_BPS: process.env.SPOT_BUILDER_FEE_BPS ?? "5",
  } as NodeJS.ProcessEnv);
  const app = Fastify({ logger: false });
  app.decorate("config", cfg);
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiException) return sendError(reply, err);
    return reply.code(500).send({ error: "INTERNAL_ERROR", message: String(err) });
  });
  await registerRoutes(app);
  return app;
}

function splitHexSig(hex: `0x${string}`) {
  const s = hex.replace(/^0x/, "");
  let v = parseInt(s.slice(128, 130), 16);
  if (v < 27) v += 27;
  return {
    r: `0x${s.slice(0, 64)}` as `0x${string}`,
    s: `0x${s.slice(64, 128)}` as `0x${string}`,
    v,
  };
}

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// Tier 1 — read + build against live testnet. No keys, no funds.
// ---------------------------------------------------------------------------

describe("testnet reads", () => {
  it("/markets returns a live universe including BTC", async () => {
    const res = await app.inject({ method: "GET", url: "/markets" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as MarketsResponse;
    expect(body.perps.length).toBeGreaterThan(10);
    const btc = body.perps.find((p) => p.name === "BTC");
    expect(btc).toBeDefined();
    expect(btc!.assetIndex).toBeGreaterThanOrEqual(0);
    expect(btc!.szDecimals).toBeGreaterThanOrEqual(0);
  });

  it("/markPrice returns a finite positive mid for BTC", async () => {
    const markets = (await app.inject({ method: "GET", url: "/markets" })).json() as MarketsResponse;
    const btc = markets.perps.find((p) => p.name === "BTC")!;
    const res = await app.inject({ method: "GET", url: `/markPrice?asset=${btc.assetIndex}` });
    expect(res.statusCode).toBe(200);
    const mid = Number((res.json() as { mid: string }).mid);
    expect(Number.isFinite(mid)).toBe(true);
    expect(mid).toBeGreaterThan(0);
  });

  it("/exchange build phase produces a signable order envelope with our builder", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/exchange",
      payload: {
        action: {
          type: "order",
          grouping: "na",
          orders: [{ a: 0, b: true, p: "1000", s: "0.001", r: false, t: { limit: { tif: "Gtc" } } }],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const built = res.json() as BuildResponse;
    expect(built.typedData?.domain?.chainId).toBe(1337);
    expect(built.builder.toLowerCase()).toBe(app.config.builderAddressLower);
    expect(built.builderFee).toBeGreaterThan(0);
    expect(built.hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("/l2Book returns a sane two-sided book for BTC", async () => {
    const res = await app.inject({ method: "GET", url: "/l2Book?coin=BTC" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { bids?: unknown[]; asks?: unknown[]; levels?: unknown[][] };
    const sides = body.bids && body.asks ? [body.bids, body.asks] : body.levels ?? [];
    expect(sides.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Tier 2 — signed roundtrip with a funded testnet wallet. Env-gated.
// ---------------------------------------------------------------------------

describe.skipIf(!PK)("testnet signed roundtrip", () => {
  const account = PK ? privateKeyToAccount(PK) : undefined!;

  /** Build → sign → send one action through the app, returning the response. */
  async function signAndSend(action: unknown): Promise<{ status: number; body: SendResponse }> {
    const buildRes = await app.inject({
      method: "POST",
      url: "/exchange",
      payload: { action, user: account.address },
    });
    expect(buildRes.statusCode).toBe(200);
    const built = buildRes.json() as BuildResponse;
    const sigHex = await account.signTypedData({
      domain: built.typedData!.domain as never,
      types: built.typedData!.types as never,
      primaryType: built.typedData!.primaryType,
      message: built.typedData!.message as never,
    });
    const sendRes = await app.inject({
      method: "POST",
      url: "/exchange",
      payload: { action: built.action, nonce: built.nonce, signature: splitHexSig(sigHex) },
    });
    return { status: sendRes.statusCode, body: sendRes.json() as SendResponse };
  }

  it("approves the builder fee (idempotent re-approval)", async () => {
    const { status, body } = await signAndSend({ type: "approveBuilderFee", maxFeeRate: "1%" });
    expect(status, JSON.stringify(body)).toBe(200);
  });

  it("places a far-from-market resting order, sees it in /openOrders, cancels it", async () => {
    // Resolve BTC + a price ~50% below mid so the order rests (never fills).
    const markets = (await app.inject({ method: "GET", url: "/markets" })).json() as MarketsResponse;
    const btc = markets.perps.find((p) => p.name === "BTC")!;
    const midRes = await app.inject({ method: "GET", url: `/markPrice?asset=${btc.assetIndex}` });
    const mid = Number((midRes.json() as { mid: string }).mid);
    // HL price rules: ≤5 significant figures. Halve the mid and truncate.
    const limitPx = Number((mid / 2).toPrecision(5)).toString();
    // ~$15 notional keeps us above HL's $10 minimum order size.
    const size = (15 / Number(limitPx)).toFixed(Math.min(6, btc.szDecimals));

    const placed = await signAndSend({
      type: "order",
      grouping: "na",
      orders: [
        { a: btc.assetIndex, b: true, p: limitPx, s: size, r: false, t: { limit: { tif: "Gtc" } } },
      ],
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(200);
    const statuses = (
      placed.body.exchangeResponse as {
        response?: { data?: { statuses?: Array<{ resting?: { oid: number } }> } };
      }
    ).response?.data?.statuses;
    const oid = statuses?.[0]?.resting?.oid;
    expect(oid, `expected a resting order, got ${JSON.stringify(statuses)}`).toBeTypeOf("number");

    // It shows up in open orders.
    const openRes = await app.inject({
      method: "POST",
      url: "/openOrders",
      payload: { user: account.address },
    });
    expect(openRes.statusCode).toBe(200);
    const open = openRes.json() as { orders?: Array<{ oid: number }> };
    expect(open.orders?.some((o) => o.oid === oid)).toBe(true);

    // Cancel it so repeated runs don't accumulate resting orders.
    const cancelled = await signAndSend({
      type: "cancel",
      cancels: [{ a: btc.assetIndex, o: oid }],
    });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
  });
});
