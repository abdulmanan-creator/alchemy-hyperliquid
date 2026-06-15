/**
 * Jurisdiction gating.
 *
 * The relay is the surface that actually forwards signed orders to the
 * exchange, so it's where US/sanctioned-jurisdiction exclusion has to be
 * enforced — a frontend banner alone doesn't stop a direct API caller.
 *
 * Country resolution leans on the edge (Cloudflare's `cf-ipcountry`), which
 * sets a trustworthy country from the real client IP that a caller can't spoof
 * past — provided the origin is only reachable through the edge. If the origin
 * is also exposed directly (e.g. the raw *.onrender.com URL), set
 * GEO_FAIL_CLOSED=true so requests arriving without an edge-stamped country are
 * refused rather than waved through.
 */

import type { FastifyRequest } from "fastify";
import type { Config } from "../config.js";

/** Cloudflare's code for a Tor exit node — no verifiable jurisdiction. */
const TOR_COUNTRY = "T1";
/** Cloudflare's code for "couldn't determine the country". */
const UNKNOWN_COUNTRY = "XX";

/**
 * Routes that constitute "connecting / trading" — the surfaces a restricted
 * jurisdiction may not use. Everything else (market data, approval-status
 * reads, preflight) stays open so the interface remains viewable, mirroring how
 * Hyperliquid serves its trade UI everywhere but blocks the connect/trade
 * action. Matched against the Fastify route template, not the raw URL.
 *
 *   /exchange         build + send orders and approveBuilderFee (the connect step)
 *   /agent/exchange   unattended agent trading
 *   /oauth/*-code     mint/redeem the OAuth token that grants MCP trading access
 */
export const GEO_RESTRICTED_ROUTES: ReadonlySet<string> = new Set([
  "/exchange",
  "/agent/exchange",
  "/oauth/issue-code",
  "/oauth/exchange-code",
]);

/** True iff this route requires an allowed jurisdiction. */
export function isGeoRestrictedRoute(routeUrl: string | undefined): boolean {
  return routeUrl !== undefined && GEO_RESTRICTED_ROUTES.has(routeUrl);
}

export type GeoOutcome =
  | { allowed: true; country: string | null }
  | { allowed: false; country: string | null; reason: "restricted" | "tor" | "unknown" };

/**
 * Read the resolved country from the configured edge header. Returns an
 * uppercased ISO alpha-2 code, or null if the header is absent/empty. Fastify
 * lowercases header names; header values may arrive as string[] on repeats.
 */
export function resolveCountry(req: FastifyRequest, config: Config): string | null {
  const raw = req.headers[config.GEO_COUNTRY_HEADER.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const code = value.trim().toUpperCase();
  return code.length > 0 ? code : null;
}

/**
 * Decide whether a request may proceed. Pure given (country, config) so it's
 * trivially unit-testable; the Fastify hook does the I/O and the reply.
 */
export function geoDecision(req: FastifyRequest, config: Config): GeoOutcome {
  if (!config.GEO_BLOCK_ENABLED) return { allowed: true, country: resolveCountry(req, config) };

  const country = resolveCountry(req, config);

  // Anonymizing networks can't be attributed to a permitted jurisdiction, and
  // the venues we route into forbid evading geo controls — refuse outright.
  if (country === TOR_COUNTRY) return { allowed: false, country, reason: "tor" };

  if (country === null || country === UNKNOWN_COUNTRY) {
    return config.GEO_FAIL_CLOSED
      ? { allowed: false, country, reason: "unknown" }
      : { allowed: true, country };
  }

  if (config.restrictedCountries.has(country)) {
    return { allowed: false, country, reason: "restricted" };
  }

  return { allowed: true, country };
}
