"use client";

import { useState } from "react";

/**
 * Code snippet with a "Copy" button in the header. Used throughout the
 * connector setup walkthroughs.
 */
export function CodeBlock({
  label,
  children,
}: {
  label: string;
  children: string;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(children).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="snippet">
      <div className="snippet-head">
        <span>{label}</span>
        <button
          className={`snippet-copy${copied ? " ok" : ""}`}
          onClick={copy}
          type="button"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}
