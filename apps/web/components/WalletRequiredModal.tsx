"use client";

/**
 * Shown when a user clicks "Run" on a send-signature endpoint from a 'Try it'
 * panel. The full sign-and-send flow lives on /approve — landing-page panels
 * don't drive wallet interactions directly so we don't end up with two
 * separate signing UIs to maintain.
 *
 * Per the project plan: "stub any send-signature 'Try it' buttons behind a
 * wallet-required modal so we don't block on the smoke test."
 */

import Link from "next/link";

export interface WalletRequiredModalProps {
  onClose: () => void;
}

export function WalletRequiredModal({ onClose }: WalletRequiredModalProps) {
  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>Wallet required</h3>
        <p>
          Sending a signed action needs a wallet connection. The signing flow lives on the
          {" "}
          <Link href="/approve" style={{ color: "var(--accent)", textDecoration: "underline" }}>
            /approve
          </Link>{" "}
          page — sign in there, approve the builder fee once, then return here to use the
          read-only endpoints. The "Run" buttons on the read-only endpoints already work
          without a wallet.
        </p>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <Link href="/approve" className="btn btn-primary">
            Go to /approve
          </Link>
        </div>
      </div>
    </div>
  );
}
