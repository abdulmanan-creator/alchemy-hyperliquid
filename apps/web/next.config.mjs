import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

// Load the monorepo-root .env so the web app and the api share one source of
// truth for env vars. Next.js by default only looks under apps/web/.env*; this
// pulls the root file in, no-ops if it doesn't exist (e.g. on Render where
// env comes from the service config).
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(__dirname, "../../.env");
if (existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
}

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@alchemy-hl/shared", "@alchemy-hl/sdk-preview"],
  experimental: {
    typedRoutes: false,
  },
};

export default nextConfig;
