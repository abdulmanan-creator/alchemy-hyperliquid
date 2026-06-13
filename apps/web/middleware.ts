import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * UI-side jurisdiction gate.
 *
 * This is UX only — the authoritative block lives on the API (the relay that
 * forwards signed orders; see apps/api/src/helpers/geo.ts). Here we just keep
 * restricted-region visitors from seeing a trading UI they can't use, by
 * rewriting them to /restricted.
 *
 * Country comes from the edge: Cloudflare's `cf-ipcountry` (the web app sits
 * behind the same CF zone as the relay), with a Vercel fallback. Unknown
 * country fails open — the API is the backstop.
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
  if (process.env.GEO_BLOCK_ENABLED === "false") return NextResponse.next();

  const country = (
    req.headers.get("cf-ipcountry") ??
    req.headers.get("x-vercel-ip-country") ??
    ""
  )
    .trim()
    .toUpperCase();

  const blocked = country === "T1" || (country !== "" && restrictedSet().has(country));
  if (!blocked) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/restricted";
  url.search = "";
  return NextResponse.rewrite(url);
}

// Run on everything except Next internals, the restricted page itself, and
// static assets — so the gate can't accidentally loop or block its own page.
export const config = {
  matcher: ["/((?!_next/|restricted|terms|favicon|robots.txt|.*\\.(?:svg|png|jpg|jpeg|ico|webp|woff2?)$).*)"],
};
