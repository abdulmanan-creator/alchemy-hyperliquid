/**
 * Thin wrapper around the Alchemy Hyperliquid API for use in the web app.
 *
 * Uses @alchemy-hl/sdk-preview for typing + transport. Reads the API base URL
 * from NEXT_PUBLIC_API_URL at build time, falls back to localhost in dev.
 */

import { AlchemyHyperliquid } from "@alchemy-hl/sdk-preview";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export const api = new AlchemyHyperliquid({ baseUrl: API_URL });

export const BUILDER_ADDR = (process.env.NEXT_PUBLIC_BUILDER_ADDR ?? "") as
  | `0x${string}`
  | "";
