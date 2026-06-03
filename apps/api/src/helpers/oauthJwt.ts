/**
 * HS256 JWT helpers for our OAuth implementation.
 *
 * We mint two token types:
 *   - Authorization codes (short-lived, ~10 min) — bound to a client_id +
 *     redirect_uri. The OAuth client (Claude/ChatGPT) exchanges these for
 *     access tokens at the /token endpoint.
 *   - Access tokens (~24 hours) — Bearer-credential the client sends on every
 *     subsequent MCP request. Carries the user's wallet address.
 *
 * Both use the same OAUTH_SIGNING_SECRET, signed via HS256. Shared between
 * the API (issues tokens) and the MCP server (verifies them).
 *
 * Trade-off: stateless JWTs mean no revocation list (tokens valid until
 * expiry). Acceptable for MVP; production would add a revocation cache.
 */

import { SignJWT, jwtVerify } from "jose";

import { ApiException } from "../errors.js";
import type { Config } from "../config.js";

/** Audience for our access tokens — distinguishes them from auth codes. */
const ACCESS_AUDIENCE = "alchemy-hl-mcp";
/** Audience for our authorization codes — distinguishes them from access tokens. */
const CODE_AUDIENCE = "alchemy-hl-mcp:code";
const ISSUER = "alchemy-hl-api";

export interface AccessTokenClaims {
  /** User's wallet address (the identity for HL trading). */
  sub: `0x${string}`;
  /** Optional login account (email / google address) — purely informational. */
  email?: string;
  /** The OAuth client this token was issued for (e.g. Claude Web). */
  client_id?: string;
}

export interface AuthCodeClaims {
  /** User's wallet address. */
  sub: `0x${string}`;
  /** Optional login account. */
  email?: string;
  /** OAuth client that initiated this auth — the same client must redeem. */
  client_id: string;
  /** Redirect URI bound at issuance — the same URI must redeem. */
  redirect_uri: string;
  /** PKCE code challenge if the client sent one (S256 only). */
  code_challenge?: string;
  code_challenge_method?: "S256";
}

function getSecretKey(cfg: Pick<Config, "OAUTH_SIGNING_SECRET">): Uint8Array {
  if (!cfg.OAUTH_SIGNING_SECRET) {
    throw new ApiException(
      "INVALID_PARAMS",
      "OAUTH_SIGNING_SECRET not configured.",
      "Generate one via `openssl rand -hex 32` and set it as an env var on both api + mcp services.",
    );
  }
  return new TextEncoder().encode(cfg.OAUTH_SIGNING_SECRET);
}

export async function signAccessToken(
  cfg: Pick<Config, "OAUTH_SIGNING_SECRET">,
  claims: AccessTokenClaims,
  expSeconds = 60 * 60 * 24, // 24 hours
): Promise<string> {
  const key = getSecretKey(cfg);
  return await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(ACCESS_AUDIENCE)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${expSeconds}s`)
    .sign(key);
}

export async function verifyAccessToken(
  cfg: Pick<Config, "OAUTH_SIGNING_SECRET">,
  token: string,
): Promise<AccessTokenClaims> {
  const key = getSecretKey(cfg);
  const { payload } = await jwtVerify(token, key, {
    issuer: ISSUER,
    audience: ACCESS_AUDIENCE,
  });
  if (typeof payload.sub !== "string" || !payload.sub.startsWith("0x")) {
    throw new Error("Access token missing or malformed sub claim.");
  }
  return {
    sub: payload.sub as `0x${string}`,
    email: typeof payload.email === "string" ? payload.email : undefined,
    client_id: typeof payload.client_id === "string" ? payload.client_id : undefined,
  };
}

export async function signAuthCode(
  cfg: Pick<Config, "OAUTH_SIGNING_SECRET">,
  claims: AuthCodeClaims,
  expSeconds = 60 * 10, // 10 minutes
): Promise<string> {
  const key = getSecretKey(cfg);
  return await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(CODE_AUDIENCE)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${expSeconds}s`)
    .sign(key);
}

export async function verifyAuthCode(
  cfg: Pick<Config, "OAUTH_SIGNING_SECRET">,
  token: string,
): Promise<AuthCodeClaims> {
  const key = getSecretKey(cfg);
  const { payload } = await jwtVerify(token, key, {
    issuer: ISSUER,
    audience: CODE_AUDIENCE,
  });
  if (typeof payload.sub !== "string" || !payload.sub.startsWith("0x")) {
    throw new Error("Auth code missing or malformed sub claim.");
  }
  if (typeof payload.client_id !== "string" || typeof payload.redirect_uri !== "string") {
    throw new Error("Auth code missing client_id or redirect_uri claim.");
  }
  return {
    sub: payload.sub as `0x${string}`,
    email: typeof payload.email === "string" ? payload.email : undefined,
    client_id: payload.client_id,
    redirect_uri: payload.redirect_uri,
    code_challenge:
      typeof payload.code_challenge === "string" ? payload.code_challenge : undefined,
    code_challenge_method:
      payload.code_challenge_method === "S256" ? "S256" : undefined,
  };
}
