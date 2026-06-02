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

const MCP_URL = "https://api.alchemy.com/hyperliquid/mcp"; // placeholder until deployed

export default function ConnectClaudePage() {
  return (
    <>
      <Nav />
      <main className="connect-shell">
        <header className="connect-head">
          <span className="eyebrow">AI Connector</span>
          <h1>Trade with Claude</h1>
          <p>
            Add nine Hyperliquid trading tools to Claude. Ask in natural
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

        <Step n={2} title="Open Claude → Settings → Connectors → Add custom">
          <p>
            In Claude Web (or Claude desktop, both work): Settings → Connectors
            → &ldquo;Add custom connector.&rdquo; In Claude desktop you may
            need to enable Developer mode in Advanced settings to see this
            option.
          </p>
        </Step>

        <Step n={3} title='Set Name to "Alchemy Hyperliquid", paste the URL'>
          <p>
            Paste the URL from step 1 into &ldquo;Remote MCP server URL&rdquo;
            and save. Claude fetches our tool list and shows the nine
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
          connector after &ldquo;Add,&rdquo; the URL might not be deployed yet
          &mdash; this page documents the target setup. If your trades return{" "}
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
