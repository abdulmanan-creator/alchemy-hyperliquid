import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Alchemy Hyperliquid",
  description:
    "Terms of Service, including jurisdictional restrictions, for the Alchemy Hyperliquid builder API.",
};

export default function TermsPage() {
  return (
    <main className="container" style={{ maxWidth: 820, padding: "64px 24px" }}>
      <h1 style={{ marginBottom: 8 }}>Terms of Service</h1>
      <p style={{ color: "var(--fg-dim)", marginBottom: 32 }}>
        Last updated: [DATE]. These terms govern access to and use of the Alchemy
        Hyperliquid builder API, SDKs, and related interfaces (the
        &quot;Service&quot;).
      </p>

      <h2 style={{ marginTop: 32 }}>1. Eligibility</h2>
      <p style={sectionP}>
        You must be at least 18 years old and legally permitted to use the
        Service under the laws of your jurisdiction. By using the Service you
        represent that you meet these requirements and that you are not a
        Restricted Person as defined below.
      </p>

      <h2 id="restricted" style={{ marginTop: 32 }}>
        2. Restricted persons and jurisdictions
      </h2>
      <p style={sectionP}>
        The Service routes orders to leveraged derivatives and other instruments
        that are not registered with, or authorized by, regulators in certain
        jurisdictions. Accordingly, the Service is{" "}
        <strong>not available to, and may not be used by</strong>:
      </p>
      <ul style={sectionUl}>
        <li>
          Persons or entities who are located in, resident in, incorporated in,
          or have a registered office in the <strong>United States of America</strong>;
        </li>
        <li>
          Persons or entities in any jurisdiction subject to comprehensive
          economic or trade sanctions or embargoes (including, without
          limitation, Cuba, Iran, North Korea, Syria, and the Crimea, Donetsk,
          and Luhansk regions); and
        </li>
        <li>
          Any person on a sanctions or denied-parties list maintained by the
          U.S. Office of Foreign Assets Control (OFAC), the EU, the UK, or
          comparable authorities.
        </li>
      </ul>
      <p style={sectionP}>
        Access is restricted by jurisdiction and enforced at the API. You{" "}
        <strong>may not</strong> use a VPN, proxy, or any other technology, and
        you may not misrepresent your residency or location, to disguise your
        location or otherwise circumvent these restrictions. Doing so is a
        material breach of these terms and may be unlawful.
      </p>

      <h2 style={{ marginTop: 32 }}>3. Nature of the service</h2>
      <p style={sectionP}>
        The Service is non-custodial infrastructure. You sign every transaction
        locally with your own keys; we construct and forward signed payloads and
        attach a builder fee within a ceiling you approve. We never take custody
        of your assets and cannot move funds without a signature you produce. The
        Service is not a broker, exchange, or investment adviser, and nothing it
        provides is financial, legal, or tax advice. Alchemy is not affiliated
        with Hyperliquid Corp or the Hyper Foundation.
      </p>

      <h2 style={{ marginTop: 32 }}>4. Risk disclosure</h2>
      <p style={sectionP}>
        Trading crypto assets and leveraged derivatives carries a high risk of
        loss, including loss in excess of deposited amounts. Prices are volatile
        and you are solely responsible for your trading decisions and for
        compliance with the laws applicable to you.
      </p>

      <h2 style={{ marginTop: 32 }}>5. No warranty; limitation of liability</h2>
      <p style={sectionP}>
        The Service is provided &quot;as is&quot; without warranties of any kind.
        To the maximum extent permitted by law, we disclaim all liability for any
        loss arising from your use of, or inability to use, the Service.
      </p>

      <h2 style={{ marginTop: 32 }}>6. Contact</h2>
      <p style={sectionP}>
        Questions about these terms: [CONTACT EMAIL].
      </p>
    </main>
  );
}

const sectionP: React.CSSProperties = {
  color: "var(--fg-muted)",
  lineHeight: 1.7,
  marginBottom: 16,
};

const sectionUl: React.CSSProperties = {
  color: "var(--fg-muted)",
  lineHeight: 1.7,
  marginBottom: 16,
  paddingLeft: 22,
};
