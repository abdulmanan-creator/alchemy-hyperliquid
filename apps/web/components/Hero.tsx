"use client";

import { useState } from "react";
import Link from "next/link";

type Lang = "python" | "ts" | "rust" | "go";

const SNIPPETS: Record<Lang, string> = {
  ts: `import { Alchemy } from "@alchemy/hyperliquid";
const sdk = new Alchemy({ privateKey: process.env.PK });
// Market buy $100 of BTC
const order = await sdk.marketBuy("BTC", { notional: 100 });
console.log(\`Filled \${order.filledSize} @ $\${order.avgPrice}\`);`,
  python: `from alchemy_hyperliquid import Alchemy
sdk = Alchemy(private_key=key)
# Market buy $100 of BTC
order = sdk.market_buy("BTC", notional=100)
print(f"Filled {order.filled_size} @ \${order.avg_price}")`,
  rust: `use alchemy_hyperliquid::Alchemy;
let sdk = Alchemy::new(env!("PK"));
// Market buy $100 of BTC
let order = sdk.market_buy("BTC", Notional(100)).await?;
println!("Filled {} @ \${}", order.filled_size, order.avg_price);`,
  go: `import "github.com/alchemyplatform/hyperliquid-go"
sdk := hyperliquid.New(os.Getenv("PK"))
// Market buy $100 of BTC
order, _ := sdk.MarketBuy("BTC", &hyperliquid.Opts{Notional: 100})
fmt.Printf("Filled %v @ $%v\\n", order.FilledSize, order.AvgPrice)`,
};

export function Hero() {
  const [lang, setLang] = useState<Lang>("ts");
  const [copied, setCopied] = useState(false);

  function onCopy() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(SNIPPETS[lang]).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  }

  return (
    <section className="hero">
      <div className="hero-inner narrow">
        <div className="hero-eyebrow">
          <span className="hero-eyebrow-tag">New</span>
          Built on Alchemy infrastructure
        </div>

        <h1>
          One line to trade <span className="hl">Hyperliquid.</span>
        </h1>
        <p className="hero-sub">
          Your keys never leave your machine. Build with the SDK, sign locally, send through Alchemy.
        </p>

        <div className="hero-ctas">
          <a className="btn btn-primary btn-lg" href="#quickstart">
            Get Started
            <svg className="btn-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </a>
          <Link className="btn btn-secondary btn-lg" href="/approve">
            Approve via Wallet
          </Link>
        </div>

        <div className="hero-pills">
          <span className="pill blue">4 SDKs</span>
          <span className="pill">Zero custody</span>
          <span className="pill cyan">Perps &amp; Spot</span>
          <span className="pill violet">HIP-3 &amp; HIP-4 Markets</span>
        </div>

        <div className="codeblock" id="quickstart">
          <div className="code-tabs" role="tablist">
            {(["python", "ts", "rust", "go"] as Lang[]).map((l) => (
              <button
                key={l}
                className={`code-tab${lang === l ? " active" : ""}`}
                role="tab"
                onClick={() => setLang(l)}
              >
                {l === "ts" ? "typescript" : l}
              </button>
            ))}
            <div className="code-traffic" aria-hidden="true"><span></span><span></span><span></span></div>
          </div>
          <div className="code-body">
            <button
              className={`code-copy${copied ? " ok" : ""}`}
              aria-label="Copy code"
              onClick={onCopy}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="ic-copy" style={{ display: copied ? "none" : undefined }}>
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h10" />
              </svg>
              <svg viewBox="0 0 24 24" aria-hidden="true" className="ic-check" style={{ display: copied ? undefined : "none" }}>
                <path d="M5 12l5 5L20 7" />
              </svg>
            </button>
            <pre>
              <code>{SNIPPETS[lang]}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
