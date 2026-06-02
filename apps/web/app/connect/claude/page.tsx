/**
 * /connect/claude — step-by-step setup walkthrough for the Claude desktop MCP
 * connector. Mirrors liquid.trade/coinvest's setup flow stylistically (numbered
 * steps, code blocks with copy buttons, callouts for prereqs).
 *
 * The flow assumes the user has already approved Alchemy as a builder for a
 * test wallet (so they're at "configure Claude desktop to use the connector"
 * stage, not "create a HL account from scratch" stage). Earlier steps point
 * them to /approve if they haven't.
 */

import Link from "next/link";

import { Nav } from "@/components/Nav";
import { CodeBlock } from "@/components/CodeBlock";
import { Footer } from "@/components/Footer";

export default function ConnectClaudePage() {
  return (
    <>
      <Nav />
      <main className="connect-shell">
        <header className="connect-head">
          <span className="eyebrow">AI Connector</span>
          <h1>Trade with Claude</h1>
          <p>
            Add nine Hyperliquid trading tools to Claude desktop via the Model
            Context Protocol. Ask Claude in natural language and it calls the
            tools for you.
          </p>
        </header>

        <div className="callout">
          <strong>Prereqs:</strong> Claude desktop installed, Node 20+, a
          funded Hyperliquid account, and you&apos;ve already approved
          Alchemy as a builder for that wallet. If not,{" "}
          <Link href="/approve">start with /approve</Link> to onboard a wallet,
          then come back.
        </div>

        <Step n={1} title="Generate a fresh test wallet">
          <p>
            Don&apos;t use your personal MetaMask &mdash; Claude desktop runs
            the connector with the wallet&apos;s private key in plaintext env.
            Better to use a dedicated key.
          </p>
          <CodeBlock label="bash">
            {`cd packages/sdk
npx tsx scripts/generate-test-wallet.ts`}
          </CodeBlock>
          <p>
            Save the printed <code>privateKey</code>. Send ~$10 USDC + ~$1
            of ETH (Arbitrum One) to the printed address.
          </p>
        </Step>

        <Step n={2} title="Deposit USDC into Hyperliquid + approve builder">
          <p>
            From the test wallet, send USDC to HL&apos;s Bridge2 contract on
            Arbitrum. We have a worked example at{" "}
            <code>packages/sdk/scripts/smoke-trade.ts</code> &mdash; it deposits,
            approves the builder fee, places a tiny test trade, and closes the
            position. Run it once to bootstrap the wallet:
          </p>
          <CodeBlock label="bash">
            {`# .env at repo root:
#   TEST_WALLET_PK=0x<from step 1>
cd packages/sdk
npx tsx scripts/smoke-trade.ts`}
          </CodeBlock>
          <p>
            After this completes, the wallet has an HL balance and Alchemy is
            approved as its builder at 1%.
          </p>
        </Step>

        <Step n={3} title="Build the MCP server">
          <CodeBlock label="bash">
            {`# From the repo root:
npm install
npm run build -w @alchemy-hl/shared
npm run build -w @alchemy-hl/sdk
npm run build -w @alchemy-hl/mcp-server`}
          </CodeBlock>
          <p>
            This produces <code>packages/mcp-server/dist/index.js</code>. That&apos;s
            the file Claude desktop will spawn.
          </p>
        </Step>

        <Step n={4} title="Add the connector to Claude desktop">
          <p>
            Open{" "}
            <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>
            {" "}(macOS &mdash; create the file if it doesn&apos;t exist; on
            Windows / Linux, see Anthropic&apos;s docs for the path). Paste this
            block, replacing <code>/absolute/path/to/repo</code> and{" "}
            <code>0x...</code> with your values:
          </p>
          <CodeBlock label="claude_desktop_config.json">
{`{
  "mcpServers": {
    "alchemy-hyperliquid": {
      "command": "node",
      "args": [
        "/absolute/path/to/repo/packages/mcp-server/dist/index.js"
      ],
      "env": {
        "ALCHEMY_HL_API_URL": "http://localhost:8080",
        "ALCHEMY_HL_TRADE_KEY": "0x<test wallet private key>"
      }
    }
  }
}`}
          </CodeBlock>
          <div className="callout warn">
            <strong>Don&apos;t commit this file.</strong> It contains a private
            key. Keep it in your local config directory only.
          </div>
        </Step>

        <Step n={5} title="Restart Claude desktop">
          <p>
            Quit Claude desktop completely (Cmd+Q on macOS, not just close
            window), then reopen. New conversations will have the{" "}
            <code>alchemy-hyperliquid</code> MCP server available with all nine
            tools.
          </p>
          <p>
            You can verify by typing <em>&ldquo;What tools do you have for
            Hyperliquid?&rdquo;</em> &mdash; Claude should enumerate them.
          </p>
        </Step>

        <Step n={6} title="Try it">
          <p>Ask Claude something like:</p>
          <CodeBlock label="example prompts">
            {`"What's the current BTC price on Hyperliquid?"

"Show me my Hyperliquid balance."

"Buy $10 of BTC on Hyperliquid."

"List my open orders and cancel any ETH orders."`}
          </CodeBlock>
          <p>
            Claude calls the relevant tool, the connector talks to our backend,
            the backend signs (via the trading key in your config) and forwards
            to Hyperliquid. Real fills, real builder fees credited back to
            Alchemy&apos;s wallet.
          </p>
        </Step>

        <div className="callout soon" style={{ marginTop: 40 }}>
          <strong>Coming next:</strong> hosted MCP server with{" "}
          <code>approveAgent</code> auth, so you don&apos;t have to manage a
          private key in Claude&apos;s config &mdash; users sign one
          authorization at <Link href="/approve">/approve</Link> and the
          connector trades on their behalf within their approved constraints.
        </div>

        <div className="callout" style={{ marginTop: 16 }}>
          <strong>Troubleshooting:</strong> if Claude desktop doesn&apos;t see
          the connector after editing the config, check that the path in{" "}
          <code>args</code> is absolute (not <code>~/</code>), the file is valid
          JSON, and you fully quit Claude desktop. Logs at{" "}
          <code>~/Library/Logs/Claude/</code>. The full README lives at{" "}
          <code>packages/mcp-server/README.md</code> in the repo.
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
