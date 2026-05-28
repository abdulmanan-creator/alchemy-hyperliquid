import Link from "next/link";

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-inner">
          <div className="footer-brand">
            <div className="footer-brand-row">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/assets/logo-wordmark-white.svg" alt="Alchemy" />
              <span>Powered by Alchemy</span>
            </div>
            <p className="footer-disclaimer">
              Alchemy Hyperliquid is not affiliated with Hyperliquid Corp or the Hyper
              Foundation. Crypto trading involves risk of loss; this product is
              infrastructure, not investment advice.
            </p>
          </div>

          <div className="footer-links">
            <div className="footer-col">
              <span className="head">Product</span>
              <a href="#api">API reference</a>
              <a href="#quickstart">Quickstart</a>
              <Link href="/approve">Approve wallet</Link>
              <a href="#fees">Fees</a>
            </div>
            <div className="footer-col">
              <span className="head">Community</span>
              <a href="#">Discord</a>
              <a href="#">GitHub</a>
              <a href="#">llms.txt</a>
              <a href="#">Status</a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
