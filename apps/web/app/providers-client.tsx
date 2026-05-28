"use client";

/**
 * Client-only loader for the real <Providers/>.
 *
 * Privy (PrivyProvider) validates its app ID at construction. During Next.js
 * static prerender that runs on the server with whatever env value the build
 * was given — which is usually a placeholder in CI. To keep build green and
 * keep the whole wallet stack truly browser-only, we dynamic-import Providers
 * with `ssr: false` so it never touches the server render path.
 *
 * The trade-off: the page renders an empty layout on the server, then hydrates
 * with the Privy-wrapped tree on the client. Acceptable for a wallet-driven
 * app — there's nothing useful to render server-side without a session anyway.
 */

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

const ProvidersInner = dynamic(
  () => import("./providers").then((m) => m.Providers),
  { ssr: false },
);

export function Providers({ children }: { children: ReactNode }) {
  return <ProvidersInner>{children}</ProvidersInner>;
}
