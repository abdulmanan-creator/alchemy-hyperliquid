/**
 * OAuth 2.1 endpoints required by Claude Web / ChatGPT Apps custom connector
 * flows. We implement the subset needed for hosted MCP:
 *
 *   GET  /.well-known/oauth-authorization-server   (RFC 8414 metadata)
 *   POST /oauth/register                            (RFC 7591 DCR)
 *   GET  /authorize                                 (redirect to web app's /oauth/authorize)
 *   POST /oauth/token                               (auth code → access token)
 *
 * State management: stateless. We don't persist registered clients — DCR
 * just returns a deterministic client_id derived from the redirect_uris
 * (anyone registering with the same redirect_uri gets the same id). Auth
 * codes and access tokens are signed JWTs (verified by HS256 with
 * OAUTH_SIGNING_SECRET shared with the api).
 *
 * Trade-offs:
 *   - No revocation list. Tokens valid until expiry. Acceptable for MVP;
 *     production would add a Redis-backed revocation cache.
 *   - No PKCE-required enforcement. We support PKCE (S256 only) if the
 *     client sends a challenge; we don't require it. Claude does send PKCE
 *     so this is exercised in practice.
 *   - DCR returns no client_secret (public clients). MCP hosts running in a
 *     browser are public clients per OAuth's classification.
 */

import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Config } from "./config.js";

/**
 * Try to handle an OAuth request. Returns true if the request was an OAuth
 * route (handled, response sent); false if it should fall through to the
 * MCP transport.
 */
export async function handleOAuthRequest(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: Config,
  log: { info: (m: string, x?: unknown) => void; warn: (m: string, x?: unknown) => void },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", cfg.MCP_PUBLIC_URL);
  const path = url.pathname;

  // RFC 8414 — authorization server metadata.
  if (path === "/.well-known/oauth-authorization-server") {
    if (req.method !== "GET") return badMethod(res, "GET");
    return sendJson(res, 200, {
      issuer: cfg.MCP_PUBLIC_URL,
      authorization_endpoint: `${cfg.MCP_PUBLIC_URL}/authorize`,
      token_endpoint: `${cfg.MCP_PUBLIC_URL}/oauth/token`,
      registration_endpoint: `${cfg.MCP_PUBLIC_URL}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["read", "trade"],
    });
  }

  // RFC 9728 — protected resource metadata. The MCP authorization spec
  // (rev 2025-06-18) requires this: clients that get a 401 with
  // `WWW-Authenticate: ... resource_metadata=<url>` fetch this URL to
  // discover which authorization server to OAuth against. Without this
  // endpoint + the 401 challenge below, MCP hosts (Claude Web) treat the
  // server as auth-less and never initiate the OAuth dance.
  if (path === "/.well-known/oauth-protected-resource") {
    if (req.method !== "GET") return badMethod(res, "GET");
    return sendJson(res, 200, {
      resource: cfg.MCP_PUBLIC_URL,
      authorization_servers: [cfg.MCP_PUBLIC_URL],
      scopes_supported: ["read", "trade"],
      bearer_methods_supported: ["header"],
    });
  }

  // RFC 7591 — Dynamic Client Registration.
  if (path === "/oauth/register") {
    if (req.method !== "POST") return badMethod(res, "POST");
    return handleRegister(req, res, cfg, log);
  }

  // OAuth authorization endpoint. We don't render UI here — redirect the
  // user to the web app's /oauth/authorize page which handles Privy sign-in
  // + approveAgent.
  if (path === "/authorize") {
    if (req.method !== "GET") return badMethod(res, "GET");
    const target = new URL(`${cfg.WEB_PUBLIC_URL}/oauth/authorize`);
    for (const [k, v] of url.searchParams) target.searchParams.append(k, v);
    res.writeHead(302, { location: target.toString() });
    res.end();
    log.info("oauth_authorize_redirect", { to: target.toString() });
    return true;
  }

  // Token endpoint — proxies to the api's /oauth/exchange-code which holds
  // the signing secret and mints the access token.
  if (path === "/oauth/token") {
    if (req.method !== "POST") return badMethod(res, "POST");
    return handleToken(req, res, cfg, log);
  }

  return false;
}

async function handleRegister(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: Config,
  log: { info: (m: string, x?: unknown) => void; warn: (m: string, x?: unknown) => void },
): Promise<boolean> {
  if (!cfg.OAUTH_SIGNING_SECRET) {
    return sendJson(res, 503, {
      error: "server_error",
      error_description: "OAUTH_SIGNING_SECRET not configured on this deployment.",
    });
  }
  const body = await readJson(req);
  if (!body || typeof body !== "object") {
    return sendJson(res, 400, { error: "invalid_request" });
  }
  const reg = body as {
    redirect_uris?: string[];
    client_name?: string;
    token_endpoint_auth_method?: string;
  };
  if (!Array.isArray(reg.redirect_uris) || reg.redirect_uris.length === 0) {
    return sendJson(res, 400, {
      error: "invalid_redirect_uri",
      error_description: "redirect_uris is required and must contain at least one URL.",
    });
  }
  // Deterministic client_id — hash the sorted redirect_uris. Same caller
  // registering twice returns the same id (idempotent registration).
  const id = createHash("sha256")
    .update([...reg.redirect_uris].sort().join("|"))
    .digest("hex")
    .slice(0, 32);
  const clientId = `alchemy-hl-mcp_${id}`;
  log.info("oauth_register", {
    client_id: clientId,
    name: reg.client_name,
    redirects: reg.redirect_uris.length,
  });
  return sendJson(res, 201, {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: reg.redirect_uris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    // No client_secret — MCP hosts are public clients (browser-resident).
    token_endpoint_auth_method: "none",
    client_name: reg.client_name ?? "Custom MCP client",
  });
}

async function handleToken(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: Config,
  log: { info: (m: string, x?: unknown) => void; warn: (m: string, x?: unknown) => void },
): Promise<boolean> {
  // /oauth/token bodies come in application/x-www-form-urlencoded per the
  // OAuth spec. Some clients also send JSON; support both.
  const params = await readFormOrJson(req);
  if (!params) {
    return sendJson(res, 400, { error: "invalid_request" });
  }
  const grant_type = params.get("grant_type");
  if (grant_type !== "authorization_code") {
    return sendJson(res, 400, {
      error: "unsupported_grant_type",
      error_description: `Only authorization_code is supported; got ${grant_type}.`,
    });
  }
  const code = params.get("code");
  const client_id = params.get("client_id");
  const redirect_uri = params.get("redirect_uri");
  const code_verifier = params.get("code_verifier") ?? undefined;
  if (!code || !client_id || !redirect_uri) {
    return sendJson(res, 400, {
      error: "invalid_request",
      error_description: "code, client_id, redirect_uri are required.",
    });
  }

  // Forward to the API's /oauth/exchange-code. The API holds the signing
  // secret and does signature + binding + PKCE verification.
  let upstream;
  try {
    upstream = await fetch(`${cfg.ALCHEMY_HL_API_URL}/oauth/exchange-code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, client_id, redirect_uri, code_verifier }),
    });
  } catch (err) {
    log.warn("oauth_token_upstream_err", { err: (err as Error).message });
    return sendJson(res, 502, {
      error: "server_error",
      error_description: "Upstream auth service unreachable.",
    });
  }
  const body = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    log.warn("oauth_token_rejected", { status: upstream.status, body });
    return sendJson(res, upstream.status, body ?? { error: "server_error" });
  }
  log.info("oauth_token_issued", { client_id });
  return sendJson(res, 200, body);
}

// ===== Helpers ===============================================================

async function readJson(req: IncomingMessage): Promise<unknown> {
  const text = await readText(req);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readFormOrJson(req: IncomingMessage): Promise<URLSearchParams | null> {
  const text = await readText(req);
  if (!text) return null;
  const ct = (req.headers["content-type"] ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    try {
      const obj = JSON.parse(text) as Record<string, string>;
      const out = new URLSearchParams();
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string") out.set(k, v);
      }
      return out;
    } catch {
      return null;
    }
  }
  return new URLSearchParams(text);
}

function readText(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): true {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
  return true;
}

function badMethod(res: ServerResponse, allowed: string): true {
  res.writeHead(405, { allow: allowed });
  res.end();
  return true;
}
