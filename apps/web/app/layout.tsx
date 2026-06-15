import type { Metadata } from "next";
import type { ReactNode } from "react";

import { GeoBanner } from "@/components/GeoBanner";
import { Providers } from "./providers-client";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alchemy Hyperliquid — One line to trade Hyperliquid.",
  description:
    "A zero-custody REST builder API for trading on Hyperliquid. Perps, spot, HIP-3 and HIP-4 markets. Your keys never leave your machine.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <GeoBanner />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
