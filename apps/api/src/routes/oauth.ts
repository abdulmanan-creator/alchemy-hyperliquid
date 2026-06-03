import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";

import { ApiException } from "../errors.js";
import { signAccessToken, signAuthCode, verifyAuthCode } from "../helpers/oauthJwt.js";
import { verifyPrivyAuth } from "../helpers/privyAuth.js";
import { AddressSchema } from "../schemas.js";

/**
 * Backend OAuth endpoints. The MCP server proxies the publicly-facing OAuth
 * surface; here we host the two operations that need our signing secret:
 *
 *   POST /oauth/issue-code
 *     Called by the web app's /oauth/authorize page once the user has signed
 *     in via Privy and signed approveAgent. Authenticated by Privy JWT.
 *     Returns a signed authorization code the web app then redirects with
 *     to the OAuth client's redirect_uri.
 *
 *   POST /oauth/exchange-code
 *     Called by the MCP server's /oauth/token endpoint to swap an auth code
 *     for an access token. Verifies the code (signature + expiry + binding
 *     to the redeeming client_id) and mints the access token.
 *
 * Both are stateless: codes are short-lived signed JWTs; access tokens are
 * longer-lived signed JWTs. Production hardening would add a revocation list
 * + single-use enforcement on codes (replay protection). For MVP, expiry +
 * binding to client_id/redirect_uri is acceptable.
 */
export async function oauthRoute(app: FastifyInstance): Promise<void> {
  // POST /oauth/issue-code — web app calls this after user finishes auth UI.
  app.post("/oauth/issue-code", async (req, reply) => {
    if (!app.config.OAUTH_SIGNING_SECRET) {
      throw new ApiException(
        "INVALID_PARAMS",
        "OAUTH_SIGNING_SECRET not configured.",
        "Set OAUTH_SIGNING_SECRET on the api service.",
      );
    }
    // The web app passes the user's Privy JWT to prove who they are; we
    // verify and use the resolved wallet as the subject of the new code.
    const auth = await verifyPrivyAuth(req.headers.authorization, app.config);

    let body;
    try {
      body = z
        .object({
          client_id: z.string().min(1),
          redirect_uri: z.string().url(),
          code_challenge: z.string().optional(),
          code_challenge_method: z.enum(["S256"]).optional(),
        })
        .parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ApiException(
          "INVALID_PARAMS",
          "Bad /oauth/issue-code body.",
          "Send { client_id, redirect_uri, code_challenge?, code_challenge_method? }.",
        );
      }
      throw err;
    }

    const code = await signAuthCode(app.config, {
      sub: auth.walletAddress,
      email: auth.loginAccount,
      client_id: body.client_id,
      redirect_uri: body.redirect_uri,
      code_challenge: body.code_challenge,
      code_challenge_method: body.code_challenge_method,
    });

    req.log.info(
      { user: auth.walletAddress, client_id: body.client_id, tokenKind: auth.tokenKind },
      "oauth_code_issued",
    );
    return reply.send({ code });
  });

  // POST /oauth/exchange-code — MCP server calls this from its /token endpoint.
  // Returns { access_token, token_type, expires_in }.
  app.post("/oauth/exchange-code", async (req, reply) => {
    if (!app.config.OAUTH_SIGNING_SECRET) {
      throw new ApiException(
        "INVALID_PARAMS",
        "OAUTH_SIGNING_SECRET not configured.",
        "Set OAUTH_SIGNING_SECRET on the api service.",
      );
    }

    let body;
    try {
      body = z
        .object({
          code: z.string().min(1),
          client_id: z.string().min(1),
          redirect_uri: z.string().url(),
          code_verifier: z.string().optional(),
        })
        .parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ApiException(
          "INVALID_PARAMS",
          "Bad /oauth/exchange-code body.",
          "Send { code, client_id, redirect_uri, code_verifier? }.",
        );
      }
      throw err;
    }

    let claims;
    try {
      claims = await verifyAuthCode(app.config, body.code);
    } catch (err) {
      throw new ApiException(
        "NOT_APPROVED",
        `Auth code invalid: ${(err as Error).message}`,
        "The code is malformed, expired, or signed with a different secret. Restart the OAuth flow.",
      );
    }

    if (claims.client_id !== body.client_id) {
      throw new ApiException(
        "NOT_APPROVED",
        "Auth code client_id mismatch.",
        "The code was issued to a different client than the one redeeming it.",
      );
    }
    if (claims.redirect_uri !== body.redirect_uri) {
      throw new ApiException(
        "NOT_APPROVED",
        "Auth code redirect_uri mismatch.",
        "The code was issued for a different redirect_uri.",
      );
    }

    // PKCE verification (S256) — if the code has a challenge, verifier required.
    if (claims.code_challenge && claims.code_challenge_method === "S256") {
      if (!body.code_verifier) {
        throw new ApiException(
          "NOT_APPROVED",
          "Auth code requires PKCE verifier.",
          "This code was issued with code_challenge; send code_verifier in the token exchange.",
        );
      }
      const expected = await sha256Base64Url(body.code_verifier);
      if (expected !== claims.code_challenge) {
        throw new ApiException(
          "NOT_APPROVED",
          "PKCE verifier does not match challenge.",
          "code_verifier must hash to code_challenge via S256.",
        );
      }
    }

    const accessToken = await signAccessToken(app.config, {
      sub: claims.sub,
      email: claims.email,
      client_id: claims.client_id,
    });
    req.log.info(
      { user: claims.sub, client_id: claims.client_id },
      "oauth_token_issued",
    );
    return reply.send({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 60 * 60 * 24,
    });
  });
}

/**
 * SHA-256 → base64url for PKCE verification. Uses Node's built-in WebCrypto
 * (no extra dependency).
 */
async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return Buffer.from(s, "binary")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
