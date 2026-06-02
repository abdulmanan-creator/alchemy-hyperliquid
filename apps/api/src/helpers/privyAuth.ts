/**
 * Privy JWT verification for agent-signed endpoints.
 *
 * Client sends `Authorization: Bearer <jwt>` from a Privy-authenticated
 * session. We verify the JWT against PRIVY_APP_ID + PRIVY_APP_SECRET, then
 * look up the user's linked wallets to find the address we'll use as their
 * agent-signing identity.
 *
 * "Their identity" is the wallet they signed approveAgent with at /approve.
 * In our app that's the Privy embedded wallet (we configure
 * createOnLogin: "users-without-wallets" and prefer the embedded wallet in
 * the /approve flow), so we filter their linked accounts to find an
 * embedded wallet and use that address. If a user has only external wallets
 * linked, we fall back to the first wallet on the account.
 *
 * The verified-user lookup is uncached for now; Privy's verifyAuthToken is
 * an in-process JWT verification (~ms) and getUser is one HTTPS call. If
 * latency matters at scale we'd cache (jwt → user) with a short TTL.
 */

import { PrivyClient, type User } from "@privy-io/server-auth";

import { ApiException } from "../errors.js";
import type { Config } from "../config.js";

let cachedClient: PrivyClient | null = null;

export interface AuthenticatedUser {
  /** Privy user id, e.g. did:privy:cl... */
  privyUserId: string;
  /** Wallet address we treat as the user's identity for HL trading. */
  walletAddress: `0x${string}`;
  /** Linked auth method that identifies this user, e.g. email or google. */
  loginAccount?: string;
}

function getClient(cfg: Config): PrivyClient {
  if (!cfg.PRIVY_APP_ID || !cfg.PRIVY_APP_SECRET) {
    throw new ApiException(
      "INVALID_PARAMS",
      "Server is not configured for Privy session auth.",
      "Set PRIVY_APP_ID and PRIVY_APP_SECRET in env, then restart. /agent/exchange requires them; other endpoints work without.",
    );
  }
  if (!cachedClient) {
    cachedClient = new PrivyClient(cfg.PRIVY_APP_ID, cfg.PRIVY_APP_SECRET);
  }
  return cachedClient;
}

/**
 * Pull the wallet address we should treat as the user's HL identity. Prefers
 * the Privy embedded wallet over external links (matches the same preference
 * our /approve UI applies — see apps/web/app/approve/page.tsx).
 */
function walletAddressFromUser(user: User): `0x${string}` | null {
  // user.linkedAccounts is an array of { type, address?, ... }. Wallet
  // linked accounts have type === "wallet" plus walletClientType field.
  const linked = (user.linkedAccounts ?? []) as Array<{
    type?: string;
    address?: string;
    walletClientType?: string;
    walletClient?: string;
  }>;
  const wallets = linked.filter((l) => l.type === "wallet" && l.address);
  if (wallets.length === 0) {
    // Fall back to user.wallet which is the "primary" wallet field.
    return ((user.wallet as { address?: string } | undefined)?.address ?? null) as
      | `0x${string}`
      | null;
  }
  const embedded = wallets.find(
    (w) => w.walletClientType === "privy" || w.walletClient === "privy",
  );
  return (embedded?.address ?? wallets[0]?.address) as `0x${string}`;
}

/**
 * Verify a `Bearer <jwt>` header and resolve it to {privyUserId, walletAddress}.
 *
 * Throws ApiException with appropriate HTTP code on failure:
 *   - 401 (NOT_APPROVED) if no token, invalid token, expired token
 *   - 422 (INVALID_PARAMS) if server isn't configured for Privy auth
 *   - 422 if the user has no usable wallet linked
 *
 * We reuse NOT_APPROVED for auth failures even though the name's awkward —
 * we don't have a generic UNAUTHORIZED code in our ErrorCode union yet.
 * Adding one is a follow-up.
 */
export async function verifyPrivyAuth(
  authHeader: string | undefined,
  cfg: Config,
): Promise<AuthenticatedUser> {
  if (!authHeader) {
    throw new ApiException(
      "NOT_APPROVED",
      "Missing Authorization header.",
      "Pass `Authorization: Bearer <privy-jwt>` to call agent-signing endpoints.",
    );
  }
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    throw new ApiException(
      "NOT_APPROVED",
      "Malformed Authorization header.",
      "Expected `Authorization: Bearer <token>`.",
    );
  }
  const token = m[1]!;

  const client = getClient(cfg);

  let claims;
  try {
    claims = await client.verifyAuthToken(token);
  } catch (err) {
    throw new ApiException(
      "NOT_APPROVED",
      `Privy JWT verification failed: ${(err as Error).message}`,
      "The Authorization token isn't valid for this app or has expired. Sign in again.",
    );
  }

  let user: User;
  try {
    user = await client.getUser(claims.userId);
  } catch (err) {
    throw new ApiException(
      "NOT_APPROVED",
      `Could not look up Privy user: ${(err as Error).message}`,
      "Token verified but user lookup failed. Try signing in again.",
    );
  }

  const walletAddress = walletAddressFromUser(user);
  if (!walletAddress) {
    throw new ApiException(
      "INVALID_PARAMS",
      "Privy user has no wallet linked.",
      "User signed in but hasn't created or linked a wallet. Visit /approve to bootstrap one.",
    );
  }

  const loginAccount =
    user.email?.address ??
    (user.google as { email?: string } | undefined)?.email ??
    undefined;

  return { privyUserId: claims.userId, walletAddress, loginAccount };
}
