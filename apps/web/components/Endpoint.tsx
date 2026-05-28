"use client";

import { useState } from "react";

import { WalletRequiredModal } from "./WalletRequiredModal";

export type FieldRow = {
  name: string;
  type: string;
  description: React.ReactNode;
};

/**
 * Two flavors of "Try it" run:
 *   - "read": call our API directly with no signature; show the JSON response.
 *   - "send": gated behind a wallet-required modal. Per spec, we don't drive
 *     the full sign-and-send dance from inside a landing-page panel — users
 *     who want that go to /approve (which is the canonical signing surface).
 */
export type RunSpec =
  | { kind: "read"; method: "GET" | "POST"; path: string; body?: () => unknown }
  | { kind: "send" };

export interface EndpointProps {
  verb: "GET" | "POST";
  path: string;
  title: string;
  description: React.ReactNode;
  fields: FieldRow[];
  returns: string;
  curl: string;
  run: RunSpec;
}

export function Endpoint(props: EndpointProps) {
  const [open, setOpen] = useState(false);
  const [tryOpen, setTryOpen] = useState(false);
  const [walletModal, setWalletModal] = useState(false);
  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<{ ok: boolean; text: string } | null>(null);

  async function onRun(e: React.MouseEvent) {
    e.stopPropagation();
    if (props.run.kind === "send") {
      setWalletModal(true);
      return;
    }
    setRunning(true);
    setResponse(null);
    try {
      const base = (typeof window !== "undefined" && process.env.NEXT_PUBLIC_API_URL) || "http://localhost:8080";
      const init: RequestInit = { method: props.run.method };
      if (props.run.method === "POST" && props.run.body) {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify(props.run.body());
      }
      const res = await fetch(`${base}${props.run.path}`, init);
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // not JSON; leave as-is
      }
      setResponse({ ok: res.ok, text: pretty });
    } catch (err) {
      setResponse({ ok: false, text: (err as Error).message });
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <article className={`endpoint${open ? " open" : ""}${tryOpen ? " try-open" : ""}`}>
        <header
          className="endpoint-head"
          onClick={() => setOpen((v) => !v)}
          style={{ cursor: "pointer" }}
        >
          <span className={`verb verb-${props.verb.toLowerCase()}`}>{props.verb}</span>
          <span className="endpoint-path">{props.path}</span>
          <span className="endpoint-title">{props.title}</span>
          <span className="endpoint-tryit">TRY IT</span>
        </header>
        <div className="endpoint-body">
          <p className="endpoint-desc">{props.description}</p>
          <table className="field-table">
            <thead>
              <tr><th>Field</th><th>Type</th><th>Description</th></tr>
            </thead>
            <tbody>
              {props.fields.map((f) => (
                <tr key={f.name}>
                  <td className="field-name">{f.name}</td>
                  <td className="field-type">{f.type}</td>
                  <td>{f.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="returns">
            <span className="returns-label">Returns</span>
            <code>{props.returns}</code>
          </div>
          <div className="tryit-bar">
            <button
              className="tryit-toggle"
              onClick={(e) => {
                e.stopPropagation();
                setTryOpen((v) => !v);
              }}
            >
              $ curl
            </button>
          </div>
          <div className="tryit-panel">
            <div className="tryit-head">
              <span>{props.verb} {props.path}</span>
              <button className="btn-run" onClick={onRun} disabled={running}>
                {running ? "Running…" : "▶ Run"}
              </button>
            </div>
            <pre className="tryit-curl">{props.curl}</pre>
            {response && (
              <pre className={`tryit-response${response.ok ? "" : " error"}`}>
                {response.text}
              </pre>
            )}
          </div>
        </div>
      </article>

      {walletModal && (
        <WalletRequiredModal onClose={() => setWalletModal(false)} />
      )}
    </>
  );
}
