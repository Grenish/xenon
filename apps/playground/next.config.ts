import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enables "use cache" + cacheTag(); Xenon expires its tags whenever content changes.
  cacheComponents: true,
  // PGlite ships WASM/data files that must be loaded from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
  // PGlite (the default when DATABASE_URL is unset) is single-process: prerender with one worker so
  // `next build` never opens the data folder from several processes at once.
  ...(process.env.DATABASE_URL ? {} : { experimental: { cpus: 1 } }),
};

export default nextConfig;
