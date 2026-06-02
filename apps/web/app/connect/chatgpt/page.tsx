/**
 * /connect/chatgpt — preview of the ChatGPT Apps setup flow.
 *
 * ChatGPT's "Apps" feature uses MCP over HTTP transport. Our existing
 * @alchemy-hl/mcp-server only ships stdio today; HTTP support is on the
 * roadmap (likely a small `streamHttpTransport()` adapter on top of the
 * same tools module). Until then this page is a stub that explains the
 * architecture + previews what the final setup flow will look like.
 */

import Link from "next/link";

import { Nav } from "@/components/Nav";
import { CodeBlock } from "@/components/CodeBlock";
import { Footer } from "@/components/Footer";

export default function ConnectChatGptPage() {
  return (
    <>
      <Nav />
      <main className="connect-shell">
        <header className="connect-head">
          <span className="eyebrow">AI Connector · Preview</span>
          <h1>Trade with ChatGPT</h1>
          <p>
            ChatGPT&apos;s Apps feature uses the same Model Context Protocol
            Claude does &mdash; over HTTP instead of stdio. Our MCP server
            already serves the right tools; we just need to ship the HTTP
            transport. Tracking this as next-after-current-iteration.
          </p>
        </header>

        <div className="callout soon">
          <strong>Status:</strong> Coming soon. The Claude connector
          (
          <Link href="/connect/claude">/connect/claude</Link>
          ) shares 100% of the underlying tools &mdash; same code, different
          transport. Once the HTTP transport ships, ChatGPT setup will look
          like the steps below.
        </div>

        <h2 style={{ marginTop: 48, marginBottom: 8, fontSize: 22 }}>What the flow will look like</h2>
        <p style={{ color: "var(--fg-muted)", marginBottom: 24, fontSize: 14, lineHeight: 1.6 }}>
          Following ChatGPT&apos;s Apps SDK pattern (mirroring the way
          liquid.trade and other early adopters set this up).
        </p>

        <Step n={1} title="Copy the connector URL">
          <CodeBlock label="connector URL">
            {`https://api.alchemy.com/hyperliquid/mcp`}
          </CodeBlock>
          <p style={{ opacity: 0.6, fontSize: 12 }}>
            (placeholder &mdash; not yet live; this is the URL the HTTP MCP
            transport will be served at)
          </p>
        </Step>

        <Step n={2} title="In ChatGPT, enable Developer mode for Apps">
          <p>
            Open ChatGPT Settings → Apps → Advanced, toggle Developer mode on.
            This unlocks the &ldquo;Create new app&rdquo; option.
          </p>
        </Step>

        <Step n={3} title='Create a new app named "Alchemy Hyperliquid"'>
          <p>
            Paste the URL above into the &ldquo;Server URL&rdquo; field, save.
            ChatGPT discovers the tools via MCP&apos;s standard handshake.
          </p>
        </Step>

        <Step n={4} title="Authenticate with Alchemy + start trading">
          <p>
            The first time you use a tool that requires signing, ChatGPT
            prompts you to authenticate. Sign in with the same Privy account
            you use at <Link href="/approve">/approve</Link>. ChatGPT now has
            scoped trading authority on your behalf (
            <Link href="/connect/claude">via the same{" "}
            <code>approveAgent</code> model</Link>
            {" "}we&apos;re building for unattended Claude trading).
          </p>
        </Step>

        <div className="callout" style={{ marginTop: 40 }}>
          <strong>Why this is on deck and not done:</strong> the underlying
          tools are identical between Claude and ChatGPT &mdash; same eight read
          tools and three write tools backed by our SDK and{" "}
          <code>/exchange</code> backend. The remaining work is just adding an
          HTTP transport to <code>@alchemy-hl/mcp-server</code> (the official
          MCP SDK has a built-in <code>StreamableHTTPServerTransport</code>),
          plus the per-user auth integration. We&apos;re sequencing it after
          the Claude flow ships so the same end-to-end gets validated once.
        </div>

        <div style={{ marginTop: 24, textAlign: "center" }}>
          <Link href="/connect/claude" className="btn btn-primary">
            Set up Claude connector instead
            <svg className="btn-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
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
