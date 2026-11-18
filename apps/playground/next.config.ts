import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enables "use cache" + cacheTag(); Xenon expires its tags whenever content changes.
  cacheComponents: true,
  // PGlite ships WASM/data files that must be loaded from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
