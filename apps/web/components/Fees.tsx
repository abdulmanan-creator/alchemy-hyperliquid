export function Fees() {
  return (
    <section className="section" id="fees">
      <div className="container">
        <div className="section-header">
          <span className="eyebrow">Fees</span>
          <h2>Two fees. Both transparent.</h2>
          <p>One goes to Alchemy for routing and infrastructure. One goes to Hyperliquid for matching. That&apos;s it.</p>
        </div>

        <div className="fees-grid">
          <div className="fees-card">
            <div className="fees-card-head">
              <div className="ftag">Alchemy</div>
              <h3>Builder Fee</h3>
              <p>Charged by Alchemy, injected into each order.</p>
            </div>
            <div className="fee-row">
              <div className="fkind">Perpetuals</div>
              <div className="fmain">0.04%</div>
              <div className="fsub"><span className="lbl">Protocol max</span> 0.1%</div>
            </div>
            <div className="fee-row">
              <div className="fkind">Spot</div>
              <div className="fmain">0.05%</div>
              <div className="fsub"><span className="lbl">Protocol max</span> 1%</div>
            </div>
          </div>

          <div className="fees-card">
            <div className="fees-card-head">
              <div className="ftag">Hyperliquid</div>
              <h3>Exchange Fee</h3>
              <p>Charged by Hyperliquid for matching.</p>
            </div>
            <div className="fee-row">
              <div className="fkind">Perpetuals</div>
              <div className="fmain">Taker 0.045%</div>
              <div className="fsub"><span className="lbl">Maker</span> 0.015%</div>
            </div>
            <div className="fee-row">
              <div className="fkind">Spot</div>
              <div className="fmain">Taker 0.070%</div>
              <div className="fsub"><span className="lbl">Maker</span> 0.040%</div>
            </div>
          </div>
        </div>

        <div className="fees-caption">
          You approve a <code>maxFeeRate</code> ceiling (e.g. <code>&quot;1%&quot;</code>) for the builder fee. The actual builder fee is always within your approved limit. You can revoke at any time.
        </div>
      </div>
    </section>
  );
}
