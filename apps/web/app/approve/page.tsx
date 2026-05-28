"use client";

/**
 * /approve — Privy-driven approveBuilderFee flow, with the design ported
 * from design/approve.html.
 *
 * State machine (matches the approve.html data-state names):
 *   "connect"  — !ready || !authenticated      (state A in the mockup)
 *   "ready"    — authenticated, ¬approved      (state B)
 *   "approved" — authenticated, approved       (state C)
 *   "pending"  — in-flight build/sign/send     (state D)
 *   "error"    — last action failed            (state E)
 *
 * Build/sign/send:
 *   1. POST /exchange { action: { type:"approveBuilderFee", maxFeeRate } }
 *      → { typedData, nonce, hash, action }
 *   2. signTypedDataAsync(typedData) via wagmi (routes through Privy)
 *   3. POST /exchange { action, nonce, signature }
 *   4. Refetch GET /approval, transition to "approved".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  usePrivy,
  useWallets,
  useFundWallet,
  type ConnectedWallet,
} from "@privy-io/react-auth";
import { useSignTypedData } from "wagmi";

import type {
  ApprovalState,
  BuildResponse,
  SendResponse,
} from "@alchemy-hl/sdk-preview";
import { api, BUILDER_ADDR } from "@/lib/api";

type Phase = "idle" | "building" | "signing" | "sending" | "refreshing";

interface ErrState {
  code?: string;
  message: string;
  guidance: string;
}

export default function ApprovePage() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { signTypedDataAsync } = useSignTypedData();
  const { fundWallet } = useFundWallet();

  const activeWallet = useMemo<ConnectedWallet | undefined>(() => wallets[0], [wallets]);
  const isEmbedded = activeWallet?.walletClientType === "privy";
  const userAddress = activeWallet?.address as `0x${string}` | undefined;

  const [approval, setApproval] = useState<ApprovalState | null>(null);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [feeRate, setFeeRate] = useState("1");
  const [error, setError] = useState<ErrState | null>(null);

  const refetchApproval = useCallback(async () => {
    if (!userAddress) {
      setApproval(null);
      return;
    }
    setApprovalLoading(true);
    setError(null);
    try {
      const state = await api.approval(userAddress);
      setApproval(state);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setApprovalLoading(false);
    }
  }, [userAddress]);

  useEffect(() => {
    void refetchApproval();
  }, [refetchApproval]);

  const runApproval = useCallback(
    async (rate: string) => {
      if (!userAddress) return;
      setError(null);
      try {
        setPhase("building");
        const built = (await api.build({
          type: "approveBuilderFee",
          maxFeeRate: rate,
        })) as BuildResponse;
        if (!built.typedData) throw new Error("Server did not return typedData.");

        setPhase("signing");
        const sigHex = await signTypedDataAsync({
          domain: built.typedData.domain,
          types: built.typedData.types,
          primaryType: built.typedData.primaryType,
          message: built.typedData.message as Record<string, unknown>,
        });
        const sig = splitHexSig(sigHex as `0x${string}`);

        setPhase("sending");
        (await api.send(built.action, built.nonce, sig)) as SendResponse;

        setPhase("refreshing");
        await refetchApproval();
        setPhase("idle");
      } catch (err) {
        setError(extractApiError(err));
        setPhase("idle");
      }
    },
    [userAddress, signTypedDataAsync, refetchApproval],
  );

  // ---- Derived state -------------------------------------------------------

  const inFlight = phase !== "idle";
  const stateName: "connect" | "ready" | "approved" | "pending" | "error" | "deposit" = (() => {
    if (!ready || !authenticated) return "connect";
    if (inFlight) return "pending";
    if (error?.code === "NEEDS_DEPOSIT") return "deposit";
    if (error) return "error";
    if (approval?.approved) return "approved";
    return "ready";
  })();

  // ---- Render --------------------------------------------------------------

  return (
    <div className="approve-shell">
      <div className="approve-nav">
        <Link href="/" className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo-wordmark-white.svg" alt="Alchemy" />
          <span className="nav-divider"></span>
          <span className="sub">Hyperliquid</span>
        </Link>
        <Link href="/" className="back">← Back to docs</Link>
      </div>

      <main className="approve-main">
        <div style={{ width: "100%", maxWidth: 520 }}>
          {stateName === "connect" && (
            <ConnectCard onLogin={login} ready={ready} />
          )}
          {stateName === "ready" && (
            <ReadyCard
              userAddress={userAddress!}
              isEmbedded={isEmbedded}
              feeRate={feeRate}
              setFeeRate={setFeeRate}
              onApprove={() => runApproval(`${feeRate}%`)}
              onDisconnect={logout}
              userDisplay={displayUser(user, userAddress)}
              approvalLoading={approvalLoading}
            />
          )}
          {stateName === "approved" && (
            <ApprovedCard
              approval={approval!}
              userAddress={userAddress!}
              isEmbedded={isEmbedded}
              onRevoke={() => runApproval("0%")}
              onDisconnect={logout}
              onFundWallet={() =>
                userAddress && fundWallet(userAddress)
              }
            />
          )}
          {stateName === "pending" && (
            <PendingCard
              phase={phase}
              userAddress={userAddress!}
              feeRate={feeRate}
              onDisconnect={logout}
            />
          )}
          {stateName === "error" && (
            <ErrorCard
              error={error!}
              userAddress={userAddress!}
              feeRate={feeRate}
              setFeeRate={setFeeRate}
              onRetry={() => runApproval(`${feeRate}%`)}
              onDisconnect={logout}
            />
          )}
          {stateName === "deposit" && (
            <DepositCard
              error={error!}
              userAddress={userAddress!}
              isEmbedded={isEmbedded}
              onDisconnect={logout}
              onRetry={() => runApproval(`${feeRate}%`)}
              onFundWallet={() => userAddress && fundWallet(userAddress)}
            />
          )}
        </div>
      </main>
    </div>
  );
}

// ============================================================================
// State cards
// ============================================================================

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="approve-card">
      <header className="approve-head">
        <span className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo-brandmark-white.svg" alt="" />
          <span>Approve Builder Fee</span>
        </span>
        <Link href="/" aria-label="Close" className="close">×</Link>
      </header>
      <div className="approve-body">{children}</div>
    </div>
  );
}

function WalletChip({
  address,
  onDisconnect,
}: {
  address: string;
  onDisconnect: () => void;
}) {
  return (
    <div className="wallet-chip">
      <span className="av"></span>
      <span>{shortAddr(address)}</span>
      <button className="dis" onClick={onDisconnect}>Disconnect</button>
    </div>
  );
}

function ConnectCard({ onLogin, ready }: { onLogin: () => void; ready: boolean }) {
  return (
    <CardShell>
      <h1 className="approve-title">Connect to continue.</h1>
      <p className="approve-sub">
        Sign in with email, Google, or an existing wallet. You&apos;ll be approving
        Alchemy as a builder so your orders can route through our infrastructure.
        You&apos;re approving a maximum fee rate (default <strong>1%</strong>). The actual
        fee is <strong>0.04% perps / 0.05% spot</strong>. You can revoke any time.
      </p>

      <button
        className="btn btn-primary btn-block"
        onClick={onLogin}
        disabled={!ready}
        style={{ marginBottom: 14 }}
      >
        {ready ? "Sign in" : "Initializing…"}
        <svg className="btn-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>

      <div className="explainer">
        Connecting only reads your address. Approving the builder fee is a separate, single
        signature you&apos;ll review on the next step.
      </div>

      <div className="card-foot">
        <span>EIP-712 typed-data signature</span>
        <a href="#fees">What&apos;s a builder fee?</a>
      </div>
    </CardShell>
  );
}

function ReadyCard(props: {
  userAddress: string;
  isEmbedded: boolean;
  feeRate: string;
  setFeeRate: (s: string) => void;
  onApprove: () => void;
  onDisconnect: () => void;
  userDisplay: string;
  approvalLoading: boolean;
}) {
  return (
    <CardShell>
      <WalletChip address={props.userAddress} onDisconnect={props.onDisconnect} />

      <h1 className="approve-title">Approve Alchemy as a builder.</h1>
      <p className="approve-sub">
        Signed in as {props.userDisplay}. Set a ceiling on the builder fee you&apos;ll allow.
        We charge well below it on every order — and you can revoke at any time with one
        signature.
      </p>

      <div className="field-group">
        <div className="field-label">
          <span className="lbl">Max fee rate</span>
          <span className="hint">Protocol max 0.1% perps · 1% spot</span>
        </div>
        <div className="fee-input">
          <input
            type="text"
            value={props.feeRate}
            onChange={(e) => props.setFeeRate(e.target.value)}
            inputMode="decimal"
          />
          <span className="suffix">%</span>
        </div>
        <div className="fee-meta">
          Actual fee per order: <strong>0.04% on perps · 0.05% on spot</strong>
        </div>
      </div>

      <button
        className="btn btn-primary btn-block"
        onClick={props.onApprove}
        disabled={props.approvalLoading}
      >
        {props.approvalLoading ? "Checking…" : "Approve Builder Fee"}
        <svg className="btn-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>

      <div className="card-foot">
        <span>
          Wallet · {props.isEmbedded ? "Privy embedded" : "External"} · Arbitrum One
        </span>
        <a href="#fees">Fee details</a>
      </div>
    </CardShell>
  );
}

function ApprovedCard(props: {
  approval: ApprovalState;
  userAddress: string;
  isEmbedded: boolean;
  onRevoke: () => void;
  onDisconnect: () => void;
  onFundWallet: () => void;
}) {
  const { approval, isEmbedded } = props;
  return (
    <CardShell>
      <WalletChip address={props.userAddress} onDisconnect={props.onDisconnect} />

      <div className="approved-badge">
        <span className="check">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
        </span>
        <div>
          <div className="ttl">Approved up to {approval.maxFeeRate}</div>
          <div className="meta">
            {approval.canTradePerps ? "Perps: ready" : "Perps: cap too low"} ·{" "}
            {approval.canTradeSpot ? "Spot: ready" : "Spot: cap too low"}
          </div>
        </div>
      </div>

      <div className="kv-list">
        <div className="kv-row">
          <span className="k">Builder address</span>
          <span className="v">{shortAddr(BUILDER_ADDR || "0x0")}</span>
        </div>
        <div className="kv-row">
          <span className="k">Max fee rate</span>
          <span className="v">{approval.maxFeeRate}</span>
        </div>
        <div className="kv-row">
          <span className="k">Charged on perps</span>
          <span className="v success">
            {approval.feeBreakdown.configuredPerpsBps / 100}%
          </span>
        </div>
        <div className="kv-row">
          <span className="k">Charged on spot</span>
          <span className="v success">
            {approval.feeBreakdown.configuredSpotBps / 100}%
          </span>
        </div>
      </div>

      <button className="btn btn-secondary btn-secondary-block" onClick={props.onRevoke}>
        Revoke
      </button>

      {isEmbedded && (
        <div style={{ marginTop: 16 }}>
          <button
            className="btn btn-secondary btn-secondary-block"
            onClick={props.onFundWallet}
          >
            Add USDC to start trading
          </button>
        </div>
      )}

      <div className="card-foot">
        <span>You can revoke any time</span>
        <a href="#">Order history ↗</a>
      </div>
    </CardShell>
  );
}

function PendingCard(props: {
  phase: Phase;
  userAddress: string;
  feeRate: string;
  onDisconnect: () => void;
}) {
  const titles: Record<Phase, string> = {
    idle: "",
    building: "Preparing the approval…",
    signing: "Confirm in your wallet…",
    sending: "Submitting to Hyperliquid…",
    refreshing: "Refreshing approval state…",
  };
  const subs: Record<Phase, string> = {
    idle: "",
    building: "Building the EIP-712 typed-data payload server-side.",
    signing: "Open your wallet (or the Privy modal) and approve the signature.",
    sending: "Forwarding your signed payload to Hyperliquid.",
    refreshing: "Reading the on-chain approval state back.",
  };
  return (
    <CardShell>
      <WalletChip address={props.userAddress} onDisconnect={props.onDisconnect} />

      <div className="pending-row">
        <span className="spinner"></span>
        <div className="txt">
          <div className="ttl">{titles[props.phase]}</div>
          <div className="sub">{subs[props.phase]}</div>
        </div>
      </div>

      <button className="btn btn-primary btn-block btn-disabled" aria-disabled="true">
        Awaiting signature
      </button>

      <details className="details">
        <summary>What you&apos;re signing</summary>
        <pre>
{`ApproveBuilderFee {
  builder:    "${shortAddr(BUILDER_ADDR || "0x0")}",
  maxFeeRate: "${props.feeRate}%",
  nonce:      ${Date.now()}
}

No transaction will be broadcast.
No funds move from this signature.`}
        </pre>
      </details>

      <div className="card-foot">
        <span>Arbitrum One · chainId 42161</span>
        <a href="#">Trouble signing?</a>
      </div>
    </CardShell>
  );
}

function ErrorCard(props: {
  error: ErrState;
  userAddress: string;
  feeRate: string;
  setFeeRate: (s: string) => void;
  onRetry: () => void;
  onDisconnect: () => void;
}) {
  return (
    <CardShell>
      <WalletChip address={props.userAddress} onDisconnect={props.onDisconnect} />

      <div className="error-banner">
        <span className="ic">!</span>
        <div>
          <div className="ttl">Something went wrong</div>
          <div>{props.error.guidance}</div>
          <div style={{ opacity: 0.7, marginTop: 4 }}>({props.error.message})</div>
        </div>
      </div>

      <div className="field-group">
        <div className="field-label">
          <span className="lbl">Max fee rate</span>
          <span className="hint">Protocol max 0.1% perps · 1% spot</span>
        </div>
        <div className="fee-input">
          <input
            type="text"
            value={props.feeRate}
            onChange={(e) => props.setFeeRate(e.target.value)}
            inputMode="decimal"
          />
          <span className="suffix">%</span>
        </div>
      </div>

      <button className="btn btn-primary btn-block" onClick={props.onRetry}>
        Try again
        <svg className="btn-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
        </svg>
      </button>

      <div className="card-foot">
        <span>Arbitrum One · chainId 42161</span>
        <a href="#">Contact support</a>
      </div>
    </CardShell>
  );
}

function DepositCard(props: {
  error: ErrState;
  userAddress: string;
  isEmbedded: boolean;
  onDisconnect: () => void;
  onRetry: () => void;
  onFundWallet: () => void;
}) {
  // Pull the deposit URL out of the guidance string the API returned. The
  // server already chose mainnet vs testnet based on HYPERLIQUID_API_URL, so
  // we just surface it verbatim instead of redoing the env check client-side.
  const urlMatch = props.error.guidance.match(/https:\/\/[^\s)]+/);
  const depositUrl = urlMatch?.[0];
  const isTestnet = depositUrl?.includes("testnet") ?? false;

  return (
    <CardShell>
      <WalletChip address={props.userAddress} onDisconnect={props.onDisconnect} />

      <h1 className="approve-title">One step first: deposit USDC.</h1>
      <p className="approve-sub">
        Even gas-free actions like <code>approveBuilderFee</code> need a non-empty
        Hyperliquid account. Drop a small amount of USDC into{" "}
        {isTestnet ? "the testnet faucet" : "your Hyperliquid balance"}, then come
        back here and click Retry.
      </p>

      {depositUrl && (
        <a
          href={depositUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary btn-block"
          style={{ marginBottom: 14 }}
        >
          {isTestnet ? "Open Hyperliquid testnet faucet" : "Open Hyperliquid deposit"}
          <svg className="btn-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </a>
      )}

      {props.isEmbedded && !isTestnet && (
        <button
          className="btn btn-secondary btn-secondary-block"
          onClick={props.onFundWallet}
          style={{ marginBottom: 14 }}
        >
          Buy USDC on Arbitrum (then bridge into Hyperliquid)
        </button>
      )}

      <button className="btn btn-secondary btn-secondary-block" onClick={props.onRetry}>
        Retry approval
      </button>

      <p style={{ fontSize: 12, color: "var(--fg-dim)", marginTop: 14, lineHeight: 1.55 }}>
        {props.error.message}
      </p>

      <div className="card-foot">
        <span>{isTestnet ? "Hyperliquid testnet" : "Hyperliquid mainnet"}</span>
        <a href="#fees">Fee details</a>
      </div>
    </CardShell>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function shortAddr(a: string): string {
  if (!a || a.length < 10) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function displayUser(
  user: ReturnType<typeof usePrivy>["user"],
  address?: string,
): string {
  return user?.email?.address ?? user?.google?.email ?? (address ? shortAddr(address) : "—");
}

function splitHexSig(hex: `0x${string}`): {
  r: `0x${string}`;
  s: `0x${string}`;
  v: number;
} {
  const stripped = hex.slice(2);
  if (stripped.length !== 130) {
    throw new Error(
      `Unexpected signature length ${stripped.length}; expected 130 hex chars.`,
    );
  }
  return {
    r: `0x${stripped.slice(0, 64)}` as `0x${string}`,
    s: `0x${stripped.slice(64, 128)}` as `0x${string}`,
    v: parseInt(stripped.slice(128, 130), 16),
  };
}

function extractApiError(err: unknown): ErrState {
  if (err && typeof err === "object" && "body" in err) {
    const body = (err as {
      body?: { error?: string; message?: string; guidance?: string };
    }).body;
    if (body?.guidance) {
      return {
        code: body.error,
        message: body.message ?? "Request failed.",
        guidance: body.guidance,
      };
    }
  }
  const message = (err as Error)?.message ?? "Something went wrong.";
  return {
    message,
    guidance: "Try again. If it keeps failing, check the browser console for details.",
  };
}
