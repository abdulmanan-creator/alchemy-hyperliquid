/**
 * /connect/chatgpt — ChatGPT Apps setup walkthrough.
 *
 * Same MCP server as Claude (HTTP transport), just registered through
 * ChatGPT's Apps SDK instead of Claude's connector flow.
 */

import Link from "next/link";

import { Nav } from "@/components/Nav";
import { CodeBlock } from "@/components/CodeBlock";
import { Footer } from "@/components/Footer";

const MCP_URL = "https://api.alchemy.com/hyperliquid/mcp"; // placeholder until deployed

export default function ConnectChatGptPage() {
  return (
    <>
      <Nav />
      <main className="connect-shell">
        <header className="connect-head">
          <span className="eyebrow">AI Connector</span>
          <h1>Trade with ChatGPT</h1>
          <p>
            Add nine Hyperliquid trading tools to ChatGPT via its Apps SDK.
            Same MCP server as the Claude connector &mdash; ChatGPT uses MCP
            over HTTP, so one URL serves both.
          </p>
        </header>

        <div className="callout">
          <strong>Prereqs:</strong> Hyperliquid account with USDC deposited.
          If you haven&apos;t onboarded yet,{" "}
          <Link href="/approve">/approve</Link> walks you through it.
        </div>

        <Step n={1} title="Copy the MCP URL">
          <CodeBlock label="MCP server URL">{MCP_URL}</CodeBlock>
        </Step>

        <Step n={2} title="In ChatGPT, enable Developer mode for Apps">
          <p>
            ChatGPT Settings → Apps → Advanced → toggle Developer mode on.
            This unlocks &ldquo;Create new app.&rdquo;
          </p>
        </Step>

        <Step n={3} title='Create a new app named "Alchemy Hyperliquid"'>
          <p>
            Paste the URL into the Server URL field and save. ChatGPT does
            an MCP handshake and discovers our nine tools.
          </p>
        </Step>

        <Step n={4} title="Connect + authorize agent">
          <p>
            Click <strong>Connect</strong>. ChatGPT opens our auth page in a
            browser tab. Sign in with Privy, sign one{" "}
            <code>approveAgent</code> action authorizing our agent wallet for
            trading. ChatGPT now has scoped trading authority &mdash; the same
            agent the Claude connector uses (one delegation, two AI clients).
          </p>
        </Step>

        <Step n={5} title="Start trading">
          <p>In ChatGPT, mention or @-tag the app:</p>
          <CodeBlock label="example prompts">
            {`"@Alchemy Hyperliquid — what's the BTC price?"

"@Alchemy Hyperliquid — buy $10 of BTC."

"@Alchemy Hyperliquid — show my open orders."`}
          </CodeBlock>
        </Step>

        <div className="callout" style={{ marginTop: 40 }}>
          <strong>One delegation, both connectors:</strong> the agent wallet
          is per-user, not per-AI. If you&apos;ve already authorized Claude
          via <Link href="/connect/claude">/connect/claude</Link>, ChatGPT
          uses the same agent and won&apos;t prompt for a second approveAgent
          signature. Revoking via either connector revokes both.
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
