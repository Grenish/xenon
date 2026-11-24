import { defineConfig, type Options } from "tsup";
import pkg from "./package.json" with { type: "json" };

/*
 * Two builds:
 *
 * 1. Server/isomorphic entries → package subpaths
 *      index → `xenon-cms`, server → `xenon-cms/server`, next → `xenon-cms/next`,
 *      postgres → `xenon-cms/postgres`, memory → `xenon-cms/memory`,
 *      storage/local → `xenon-cms/storage/local`, storage/s3 → `xenon-cms/storage/s3`
 *
 * 2. Client bundle → `xenon-cms/client` (internal): every admin client component in ONE module with a
 *    top-level `"use client"` banner. Server code imports it via the self-reference "xenon-cms/client",
 *    which stays external, so the directive survives and Next.js sees a proper client boundary.
 *
 * Styles are compiled separately by the Tailwind CLI → dist/styles.css (`xenon-cms/styles.css`).
 */
const shared: Options = {
  format: ["esm"],
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: false, // `build` script wipes dist once; parallel builds must not delete each other's output
  treeshake: true,
  define: { __XENON_VERSION__: JSON.stringify(pkg.version) },
  external: [
    "xenon-cms/client",
    "zod",
    "react",
    "react-dom",
    /^react\//,
    /^react-dom\//,
    "next",
    /^next\//,
    "drizzle-orm",
    /^drizzle-orm\//,
    "better-auth",
    /^better-auth\//,
    "postgres",
    "@electric-sql/pglite",
    "aws4fetch",
    "image-size",
    "@base-ui/react",
    /^@base-ui\/react\//,
    "@remixicon/react",
    /^@tiptap\//,
    "sonner",
    "class-variance-authority",
    "clsx",
    "tailwind-merge",
  ],
};

export default defineConfig([
  {
    ...shared,
    entry: {
      index: "src/index.ts",
      server: "src/server/index.ts",
      next: "src/next/index.ts",
      react: "src/react/index.ts",
      postgres: "src/adapters/postgres/index.ts",
      pglite: "src/adapters/postgres/pglite.ts",
      drizzle: "src/adapters/postgres/drizzle.ts",
      memory: "src/adapters/memory.ts",
      "storage/local": "src/storage/local.ts",
      "storage/s3": "src/storage/s3.ts",
    },
    platform: "node",
    splitting: true,
  },
  {
    ...shared,
    entry: { client: "src/ui/client.ts" },
    platform: "browser",
    splitting: false,
    // tsup's `treeshake` runs a rollup pass that drops module-level directives; esbuild keeps the banner.
    treeshake: false,
    banner: { js: '"use client";' },
  },
  {
    ...shared,
    entry: { cli: "src/cli/index.ts" },
    platform: "node",
    dts: false,
    splitting: false,
    banner: { js: "#!/usr/bin/env node" },
  },
]);
