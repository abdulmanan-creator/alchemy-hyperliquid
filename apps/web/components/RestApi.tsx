"use client";

/**
 * REST API documentation section.
 *
 * Three groups:
 *   A. Build (no signature) — POST /exchange variants. 'Run' goes through our
 *      backend /exchange Phase A; the response is the typed-data envelope.
 *   B. Send (with signature) — same path, with a sig. 'Run' is stubbed behind
 *      WalletRequiredModal per the project plan.
 *   C. Enhanced (read/utility) — GET /approval, /markets, /dexes, POST
 *      /openOrders, /orderStatus, /preflight. All "read" endpoints; 'Run'
 *      hits our backend directly.
 *
 * The Endpoint cards do the rendering + Run wiring; this file just describes
 * each endpoint and lets the card handle the rest.
 */

import { Endpoint } from "./Endpoint";

// A few defaults the 'Run' buttons send so the example actually works against
// our backend without requiring the user to type anything first.
const SAMPLE_USER = "0x4F1c000000000000000000000000000000000000";
const SAMPLE_ORDER_BUILD = {
  action: {
    type: "order",
    grouping: "na",
    orders: [
      { a: 0, b: true, p: "62500", s: "0.001", r: false, t: { limit: { tif: "Gtc" } } },
    ],
  },
};
const SAMPLE_APPROVE_BUILD = {
  action: { type: "approveBuilderFee", maxFeeRate: "1%" },
};
const SAMPLE_CANCEL_BUILD = {
  action: { type: "cancel", cancels: [{ a: 0, o: 1234567 }] },
};
const SAMPLE_PREFLIGHT_BODY = {
  action: SAMPLE_ORDER_BUILD.action,
};

export function RestApi() {
  return (
    <section className="section" id="api">
      <div className="container">
        <div className="section-header">
          <span className="eyebrow">REST API</span>
          <h2>Build without signature, send with signature.</h2>
          <p>Click any endpoint to inspect the schema, see the response shape, and run an example against our backend.</p>
        </div>

        <div className="api-groups">
          {/* Group A: Build (no signature) */}
          <div className="api-group">
            <div className="api-group-header">
              <h3>Exchange — Build (no signature)</h3>
              <span className="grp-tag">no auth · runs live</span>
            </div>
            <div className="endpoint-list">
              <Endpoint
                verb="POST"
                path="/exchange"
                title="Build Order"
                description={
                  <>
                    Construct a typed-data order payload ready to be signed in the user's wallet. No signature is performed server-side — the response is the exact EIP-712 message you'll sign before calling <code>Send Order</code>.
                  </>
                }
                fields={[
                  { name: "action.orders[].a", type: "number", description: <>Asset id, e.g. <code>0</code> for BTC perp. Spot uses <code>10000 + idx</code>.</> },
                  { name: "action.orders[].b", type: "boolean", description: "true = buy, false = sell" },
                  { name: "action.orders[].p", type: "string", description: "Limit price as a decimal string." },
                  { name: "action.orders[].s", type: "string", description: "Size in base units." },
                  { name: "action.orders[].t", type: "object", description: <>Time-in-force, e.g. <code>{`{ limit: { tif: "Gtc" } }`}</code></> },
                  { name: "action.grouping", type: '"na"', description: "Order grouping — usually \"na\"." },
                ]}
                returns="{ hash, nonce, action, isSpot, builderFee, builder, typedData }"
                curl={`curl -X POST $API/exchange \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(SAMPLE_ORDER_BUILD)}'`}
                run={{ kind: "read", method: "POST", path: "/exchange", body: () => SAMPLE_ORDER_BUILD }}
              />

              <Endpoint
                verb="POST"
                path="/exchange"
                title="Build Cancel"
                description="Build a cancellation payload for one or more resting orders by order id (OID). Returns typed data ready for the user's signature."
                fields={[
                  { name: "action.type", type: '"cancel"', description: "Discriminator." },
                  { name: "action.cancels[].a", type: "number", description: "Asset id of the order being cancelled." },
                  { name: "action.cancels[].o", type: "number", description: "On-chain order id." },
                ]}
                returns="{ hash, nonce, action, isSpot:false, builderFee:0, builder, typedData }"
                curl={`curl -X POST $API/exchange \\
  -d '${JSON.stringify(SAMPLE_CANCEL_BUILD)}'`}
                run={{ kind: "read", method: "POST", path: "/exchange", body: () => SAMPLE_CANCEL_BUILD }}
              />

              <Endpoint
                verb="POST"
                path="/exchange"
                title="Build Approval (approveBuilderFee)"
                description={
                  <>
                    Build the one-time EIP-712 payload that authorises Alchemy as a builder for the connected wallet. The user signs it once to set their <code>maxFeeRate</code> ceiling — every subsequent order's builder fee falls inside that ceiling.
                  </>
                }
                fields={[
                  { name: "action.type", type: '"approveBuilderFee"', description: "Discriminator." },
                  { name: "action.maxFeeRate", type: "string", description: <>Ceiling as a percent, e.g. <code>{`"1%"`}</code>. The actual fee on each order is lower.</> },
                ]}
                returns="{ typedData: EIP712, nonce, action: { hyperliquidChain, builder, maxFeeRate, nonce, signatureChainId } }"
                curl={`curl -X POST $API/exchange \\
  -d '${JSON.stringify(SAMPLE_APPROVE_BUILD)}'`}
                run={{ kind: "read", method: "POST", path: "/exchange", body: () => SAMPLE_APPROVE_BUILD }}
              />
            </div>
          </div>

          {/* Group B: Send (with signature) */}
          <div className="api-group">
            <div className="api-group-header">
              <h3>Exchange — Send (with signature)</h3>
              <span className="grp-tag">signed · use /approve to sign</span>
            </div>
            <div className="endpoint-list">
              <Endpoint
                verb="POST"
                path="/exchange"
                title="Send Order"
                description="Submit a previously-built order along with its EIP-712 signature. Alchemy verifies the signature locally, re-checks the builder fee, and forwards to Hyperliquid."
                fields={[
                  { name: "action", type: "object", description: "The original built action, unchanged." },
                  { name: "nonce", type: "number", description: "Nonce from the build step." },
                  { name: "signature", type: "{ r, s, v }", description: "EIP-712 signature over the typed data." },
                ]}
                returns="{ success, user, exchangeResponse }"
                curl={`curl -X POST $API/exchange \\
  -d '{ "action": {...}, "nonce": 1716830000000, "signature": { "r": "0x..", "s": "0x..", "v": 27 } }'`}
                run={{ kind: "send" }}
              />

              <Endpoint
                verb="POST"
                path="/exchange"
                title="Send Cancel"
                description="Submit a signed cancel. Idempotent for already-filled orders."
                fields={[
                  { name: "action", type: 'cancel', description: "From the build step." },
                  { name: "nonce", type: "number", description: "Nonce from build." },
                  { name: "signature", type: "{ r, s, v }", description: "EIP-712 signature." },
                ]}
                returns="{ success, user, exchangeResponse }"
                curl={`curl -X POST $API/exchange -d '{ "action": {...}, "nonce":..., "signature":{...} }'`}
                run={{ kind: "send" }}
              />

              <Endpoint
                verb="POST"
                path="/exchange"
                title="Send Approval"
                description={
                  <>
                    Submit the signed <code>approveBuilderFee</code> payload. Once accepted, the wallet is approved and subsequent orders auto-include the builder fee within the user's <code>maxFeeRate</code> ceiling.
                  </>
                }
                fields={[
                  { name: "action", type: "approveBuilderFee", description: "Filled by the build step." },
                  { name: "nonce", type: "number", description: "Nonce from build." },
                  { name: "signature", type: "{ r, s, v }", description: "EIP-712 signature." },
                ]}
                returns="{ success, user, exchangeResponse }"
                curl={`curl -X POST $API/exchange -d '{ "action": {...}, "nonce":..., "signature":{...} }'`}
                run={{ kind: "send" }}
              />
            </div>
          </div>

          {/* Group C: Enhanced */}
          <div className="api-group">
            <div className="api-group-header">
              <h3>Enhanced Endpoints</h3>
              <span className="grp-tag">read-only · runs live</span>
            </div>
            <div className="endpoint-list">
              <Endpoint
                verb="GET"
                path="/approval"
                title="Check Approval"
                description="Check whether a wallet has approved Alchemy as a builder, and at what ceiling. Useful for gating order entry in your UI."
                fields={[
                  { name: "?user", type: "address", description: "Wallet to check (query string)." },
                ]}
                returns="{ approved, maxFeeRate, maxFeeRaw, canTradePerps, canTradeSpot, feeBreakdown }"
                curl={`curl "$API/approval?user=${SAMPLE_USER}"`}
                run={{ kind: "read", method: "GET", path: `/approval?user=${SAMPLE_USER}` }}
              />

              <Endpoint
                verb="POST"
                path="/openOrders"
                title="Open Orders (with pre-built cancel actions)"
                description="List a wallet's resting orders. The response also includes pre-built cancel payloads — sign and submit to cancel any subset without re-fetching state."
                fields={[
                  { name: "user", type: "address", description: "Wallet to query." },
                ]}
                returns="{ user, orders: [{ oid, assetIndex, side, limitPx, sz, origSz, timestamp, cancelAction }] }"
                curl={`curl -X POST $API/openOrders -d '{ "user": "${SAMPLE_USER}" }'`}
                run={{ kind: "read", method: "POST", path: "/openOrders", body: () => ({ user: SAMPLE_USER }) }}
              />

              <Endpoint
                verb="POST"
                path="/orderStatus"
                title="Order Status"
                description="Look up the lifecycle status of an order by OID, with a plain-English explanation alongside the raw response."
                fields={[
                  { name: "user", type: "address", description: "Owner of the order." },
                  { name: "oid", type: "number", description: "On-chain order id." },
                ]}
                returns='{ user, oid, status, explanation, raw }'
                curl={`curl -X POST $API/orderStatus -d '{ "user": "${SAMPLE_USER}", "oid": 1234567 }'`}
                run={{ kind: "read", method: "POST", path: "/orderStatus", body: () => ({ user: SAMPLE_USER, oid: 1234567 }) }}
              />

              <Endpoint
                verb="POST"
                path="/preflight"
                title="Preflight (validate without signing)"
                description="Dry-run an order against our validation. Surface mixed-surface errors, cap violations, and the exact builder fee that would be charged — without producing a typed-data payload."
                fields={[
                  { name: "action", type: "order", description: "An order action you would build." },
                ]}
                returns="{ valid, errors, assetInfo, estimatedFee, isSpot }"
                curl={`curl -X POST $API/preflight -d '${JSON.stringify(SAMPLE_PREFLIGHT_BODY)}'`}
                run={{ kind: "read", method: "POST", path: "/preflight", body: () => SAMPLE_PREFLIGHT_BODY }}
              />

              <Endpoint
                verb="GET"
                path="/markets"
                title="List Markets"
                description="All perp and spot markets exposed by Hyperliquid, plus placeholders for HIP-3 / HIP-4 surfaces. Includes asset index, size decimals, and max leverage (perps only)."
                fields={[]}
                returns="{ perps: [...], spot: [...], hip3: [], hip4: [] }"
                curl={`curl "$API/markets"`}
                run={{ kind: "read", method: "GET", path: "/markets" }}
              />

              <Endpoint
                verb="GET"
                path="/dexes"
                title="List HIP-3 Dexes"
                description="Discover permissionless HIP-3 dexes deployed on Hyperliquid. Each entry includes a slug and address; builder-fee fields surface here as HL exposes them."
                fields={[]}
                returns="{ dexes: [{ name, address, builderFeeBps? }] }"
                curl={`curl "$API/dexes"`}
                run={{ kind: "read", method: "GET", path: "/dexes" }}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
