"use client";

import Link from "next/link";

/**
 * "Trade with AI" section. Two CTA cards routing to /connect/claude and
 * /connect/chatgpt. The Claude card links to a real setup walkthrough; the
 * ChatGPT card is a "coming soon" stub since we only ship stdio MCP today.
 *
 * Sits between Features and RestApi on the landing page. The visual style
 * deliberately matches the existing feature-card grid so the page composition
 * stays consistent.
 */
export function AiConnectors() {
  return (
    <section className="section" id="ai">
      <div className="container">
        <div className="section-header">
          <span className="eyebrow">Trade with AI</span>
          <h2>Hyperliquid in your AI chat.</h2>
          <p>
            Connect Claude or ChatGPT to Alchemy Hyperliquid. Ask in natural
            language &mdash; &ldquo;buy $50 of BTC,&rdquo; &ldquo;what&apos;s my
            position?&rdquo; &mdash; and the AI calls the trading API for you.
          </p>
        </div>

        <div className="feature-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
          <ConnectorCard
            href="/connect/claude"
            badge="Available now"
            badgeKind="ready"
            title="Trade with Claude"
            body="Adds nine trading tools to Claude desktop via the Model Context Protocol. Read market data, place orders, manage positions — all from chat."
            cta="Set up Claude →"
            iconChar="C"
            iconColor="#D97757"
          />
          <ConnectorCard
            href="/connect/chatgpt"
            badge="Coming soon"
            badgeKind="soon"
            title="Trade with ChatGPT"
            body="Same nine tools, exposed as a ChatGPT App via MCP over HTTP. Available once we ship the HTTP transport — likely days, not weeks."
            cta="Setup preview →"
            iconChar="G"
            iconColor="#10A37F"
          />
        </div>
      </div>
    </section>
  );
}

function ConnectorCard(props: {
  href: string;
  badge: string;
  badgeKind: "ready" | "soon";
  title: string;
  body: string;
  cta: string;
  iconChar: string;
  iconColor: string;
}) {
  return (
    <Link
      href={props.href}
      className="feature-card"
      style={{ textDecoration: "none", color: "inherit", display: "block" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <span
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: props.iconColor,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 18,
            color: "#fff",
            flexShrink: 0,
          }}
        >
          {props.iconChar}
        </span>
        <span
          className={`pill ${props.badgeKind === "ready" ? "cyan" : ""}`}
          style={{
            fontSize: 11,
            padding: "3px 10px",
            opacity: props.badgeKind === "ready" ? 1 : 0.7,
          }}
        >
          {props.badge}
        </span>
      </div>
      <h3>{props.title}</h3>
      <p>{props.body}</p>
      <div
        style={{
          marginTop: 16,
          fontSize: 14,
          color: "var(--accent)",
          fontWeight: 500,
        }}
      >
        {props.cta}
      </div>
    </Link>
  );
}
