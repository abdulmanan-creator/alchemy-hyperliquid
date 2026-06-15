import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * UI-side jurisdiction signal.
 *
 * We do NOT block the page — restricted visitors should still be able to view
 * the interface and read-only market data (Hyperliquid's model), and we need to
 * be able to load the site for testing from a restricted IP. Instead we stamp a
 * `geo_restricted` cookie that the client reads to show the banner (GeoBanner)
 * and disable the connect entry. The authoritative block lives on the API,
 * which rejects the trade/connection routes with 451 (apps/api/helpers/geo.ts).
 *
 * Country comes from the edge: Cloudflare's `cf-ipcountry`, Vercel fallback.
 */

const DEFAULT_RESTRICTED = "US,CU,IR,KP,SY,RU";

function restrictedSet(): Set<string> {
  const raw = process.env.RESTRICTED_COUNTRIES ?? DEFAULT_RESTRICTED;
  return new Set(
    raw
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean),
  );
}

export function middleware(req: NextRequest): NextResponse {
  const res = NextResponse.next();
  if (process.env.GEO_BLOCK_ENABLED === "false") {
    res.cookies.set("geo_restricted", "0", { path: "/", sameSite: "lax" });
    return res;
  }

  const country = (
    req.headers.get("cf-ipcountry") ??
    req.headers.get("x-vercel-ip-country") ??
    ""
  )
    .trim()
    .toUpperCase();

  const blocked = country === "T1" || (country !== "" && restrictedSet().has(country));
  res.cookies.set("geo_restricted", blocked ? "1" : "0", { path: "/", sameSite: "lax" });
  if (country) res.cookies.set("geo_country", country, { path: "/", sameSite: "lax" });
  return res;
}

// Stamp the cookie on page navigations; skip Next internals and static assets.
export const config = {
  matcher: ["/((?!_next/|favicon|robots.txt|.*\\.(?:svg|png|jpg|jpeg|ico|webp|woff2?)$).*)"],
};
