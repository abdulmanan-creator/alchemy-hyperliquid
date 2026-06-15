"use client";

/**
 * Client-side read of the jurisdiction flag set by middleware.ts (the
 * `geo_restricted` cookie). This drives UX only — disclosure banner + disabling
 * the connect entry. The authoritative block is the API, which rejects the
 * trade/connection routes with 451 regardless of what the UI does.
 *
 * Starts `false` until mounted so we never flash the banner at permitted users
 * during hydration; restricted users see it a beat after first paint.
 */

import { useEffect, useState } from "react";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export interface GeoState {
  restricted: boolean;
  country: string | null;
}

export function useGeoRestricted(): GeoState {
  const [state, setState] = useState<GeoState>({ restricted: false, country: null });
  useEffect(() => {
    setState({
      restricted: readCookie("geo_restricted") === "1",
      country: readCookie("geo_country"),
    });
  }, []);
  return state;
}
