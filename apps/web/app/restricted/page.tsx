import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Not available in your region — Alchemy Hyperliquid",
  robots: { index: false, follow: false },
};

export default function RestrictedPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          maxWidth: 520,
          width: "100%",
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-lg)",
          padding: "40px 36px",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 24, marginBottom: 12 }}>Not available in your region</h1>
        <p style={{ color: "var(--fg-muted)", lineHeight: 1.6, marginBottom: 16 }}>
          Trading perpetuals, spot, and prediction markets through this service
          is restricted in the United States and sanctioned jurisdictions for
          regulatory reasons.
        </p>
        <p style={{ color: "var(--fg-dim)", fontSize: 14, lineHeight: 1.6 }}>
          Attempting to bypass this restriction — for example with a VPN — is a
          violation of our terms. If you reached this page in error, contact
          support.
        </p>
      </div>
    </main>
  );
}
