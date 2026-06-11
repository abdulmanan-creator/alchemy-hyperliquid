/**
 * /connect/claude — step-by-step setup walkthrough for the Claude Web /
 * Claude desktop MCP connector.
 *
 * Default flow assumes hosted MCP (agent-mode auth via Privy JWT). A footer
 * callout points power users to the local stdio install for hot-key signing.
 */

import Link from "next/link";

import { Nav } from "@/components/Nav";
import { CodeBlock } from "@/components/CodeBlock";
import { Footer } from "@/components/Footer";

import { normalizeUrl } from "@/lib/api";

// Resolved at build time from NEXT_PUBLIC_MCP_URL (wired via render.yaml
// fromService → alchemy-hl-mcp host). Falls back to a placeholder if unset
// so dev / preview environments still render the page.
const MCP_URL = normalizeUrl(
  process.env.NEXT_PUBLIC_MCP_URL ?? "https://alchemy-hl-mcp.onrender.com",
);

export default function ConnectClaudePage() {
  return (
    <>
      <Nav />
      <main className="connect-shell">
        <header className="connect-head">
          <span className="eyebrow">AI Connector</span>
          <h1>Trade with Claude</h1>
          <p>
            Add ten Hyperliquid trading tools to Claude. Ask in natural
            language; Claude calls the tools, our backend signs trades using
            an agent key you authorized once.
          </p>
        </header>

        <div className="callout">
          <strong>Prereqs:</strong> Hyperliquid account with USDC deposited.
          If you haven&apos;t onboarded yet,{" "}
          <Link href="/approve">/approve</Link> walks you through Privy
          sign-in + builder approval + deposit.
        </div>

        <Step n={1} title="Copy the MCP URL">
          <p>
            This is the URL you&apos;ll paste into Claude as a custom MCP
            server.
          </p>
          <CodeBlock label="MCP server URL">{MCP_URL}</CodeBlock>
        </Step>

        <Step n={2} title="Open the connector dialog in Claude Web">
          <p>
            One click opens the &ldquo;Add custom connector&rdquo; modal
            directly in Claude Web (skips the Settings → Connectors menu
            dive). Claude desktop users with Developer mode enabled can use
            the same flow there.
          </p>
          <div style={{ marginTop: 14 }}>
            <a
              className="btn btn-primary"
              href="https://claude.ai/customize/connectors?modal=add-custom-connector"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Claude Web
              <svg className="btn-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </a>
          </div>
          <div className="callout warn" style={{ marginTop: 14 }}>
            <strong>If the connector option isn&apos;t visible:</strong> custom
            connectors are a beta feature gated by Anthropic. Most work / team
            accounts have it disabled by org policy. For testing today, use a
            personal Claude.ai Pro account; for users at locked-down orgs,
            we&apos;ll route them to ChatGPT Apps or the local Claude desktop
            install as alternatives.
          </div>
        </Step>

        <Step n={3} title='Set Name to "Alchemy Hyperliquid", paste the URL'>
          <p>
            Paste the URL from step 1 into &ldquo;Remote MCP server URL&rdquo;
            and save. Claude fetches our tool list and shows the ten
            available functions.
          </p>
        </Step>

        <Step n={4} title="Connect + authorize agent">
          <p>
            Click <strong>Connect</strong> next to the new connector. Claude
            opens our auth page. Sign in with Privy (same account you use at{" "}
            <Link href="/approve">/approve</Link>), then sign one{" "}
            <code>approveAgent</code> action delegating trading authority to
            our server-managed agent wallet. After this single signature,
            Claude can trade on your behalf with no further prompts.
          </p>
          <div className="callout">
            <strong>What you&apos;re authorizing:</strong> a per-user agent
            key derived deterministically from a server-side master seed. The
            agent has <em>trade-only</em> authority &mdash; HL&apos;s protocol
            enforces that agents can&apos;t withdraw your funds. You can
            revoke any time by signing approveAgent again with the zero
            address.
          </div>
        </Step>

        <Step n={5} title="Start trading">
          <p>Open a new conversation in Claude and try:</p>
          <CodeBlock label="example prompts">
            {`"What's the current BTC price on Hyperliquid?"

"Show me my Hyperliquid balance."

"Buy $10 of BTC."

"List my open orders and cancel any ETH orders."`}
          </CodeBlock>
        </Step>

        <div className="callout soon" style={{ marginTop: 40 }}>
          <strong>Power-user alternative (stdio mode):</strong> if you&apos;d
          rather run the MCP server locally with a hot private key (single-user,
          no hosted dependency), see <code>packages/mcp-server/README.md</code>
          {" "}in the repo. More setup but no shared infra.
        </div>

        <div className="callout" style={{ marginTop: 16 }}>
          <strong>Troubleshooting:</strong> if Claude can&apos;t reach the
          connector after &ldquo;Add,&rdquo; check the server is up at{" "}
          <code>{MCP_URL}/healthz</code>. If your trades return{" "}
          <code>NEEDS_DEPOSIT</code>, the wallet hasn&apos;t deposited USDC
          into HL yet; visit <Link href="/approve">/approve</Link>.
        </div>
      </main>
      <Footer />
    </>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="step">
      <div className="step-num">{n}</div>
      <div className="step-body">
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}
