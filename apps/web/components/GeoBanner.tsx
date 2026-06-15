"use client";

/**
 * Persistent top banner shown to visitors in a restricted jurisdiction.
 *
 * Mirrors Hyperliquid's model: the interface stays fully viewable; only the
 * connect/trade actions are disabled (see the API 451 + the disabled connect
 * button on /approve). This banner is the disclosure half.
 */

import Link from "next/link";

import { useGeoRestricted } from "@/lib/geo";

export function GeoBanner() {
  const { restricted } = useGeoRestricted();
  if (!restricted) return null;
  return (
    <div
      role="alert"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 200,
        width: "100%",
        background: "rgba(245, 158, 11, 0.12)",
        borderBottom: "1px solid var(--warning)",
        color: "var(--fg)",
        padding: "10px 20px",
        textAlign: "center",
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      This interface is <strong>not available in your region</strong>. You can
      browse, but connecting a wallet and trading are disabled.{" "}
      <Link href="/terms" style={{ color: "var(--warning)", textDecoration: "underline" }}>
        Learn more
      </Link>
      .
    </div>
  );
}
