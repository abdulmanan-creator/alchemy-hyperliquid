const FEATURES: {
  title: string;
  body: string;
  snippet: string;
  icon: JSX.Element;
}[] = [
  {
    title: "One-Line Trading",
    body: "Market buy or sell by ticker. No order builder, no signing dance — the SDK handles it end-to-end.",
    snippet: `sdk.marketBuy("BTC", { notional: 100 })`,
    icon: (
      <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    ),
  },
  {
    title: "Zero Custody",
    body: "Private keys are signed locally and never transit our servers. We see signed payloads, not secrets.",
    snippet: `// Private key stays local`,
    icon: (
      <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 1 1 8 0v3" /></svg>
    ),
  },
  {
    title: "Real-Time Streaming",
    body: "WebSocket subscriptions for trades, book updates, fills, and account state — auto-reconnect included.",
    snippet: `sdk.stream.trades(["BTC"], cb)`,
    icon: (
      <svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 16 0M4 12a8 8 0 0 0 16 0M4 12h16" /></svg>
    ),
  },
  {
    title: "Full Market Data",
    body: "L2 books, candles, funding history, mark and oracle prices. Block-perfect, delivered by Alchemy.",
    snippet: `sdk.info.l2Book("ETH")`,
    icon: (
      <svg viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6" /></svg>
    ),
  },
  {
    title: "HIP-3 Markets",
    body: "Permissionless market dexes from any builder. Address them as dex:SYMBOL and trade the same way.",
    snippet: `sdk.buy("xyz:SILVER", { notional: 11 })`,
    icon: (
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M12 4v16M4 12h16" /></svg>
    ),
  },
  {
    title: "Advanced Orders",
    body: "TWAP, scale, post-only, reduce-only, IOC, ALO, and trigger orders — all behind ergonomic primitives.",
    snippet: `sdk.twapOrder("BTC", { size: 0.1 })`,
    icon: (
      <svg viewBox="0 0 24 24"><path d="M4 6h10M4 12h16M4 18h7" /><circle cx="18" cy="6" r="2" /><circle cx="14" cy="18" r="2" /></svg>
    ),
  },
];

export function Features() {
  return (
    <section className="section" id="features">
      <div className="container">
        <div className="section-header">
          <span className="eyebrow">Everything you need</span>
          <h2>From a single line of code to advanced execution.</h2>
          <p>Six primitives cover most of what a trading agent or bot will need. The full SDK surfaces the rest.</p>
        </div>

        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="feature-card" key={f.title}>
              <span className="feature-icon">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
              <div className="feature-snippet">{f.snippet}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
