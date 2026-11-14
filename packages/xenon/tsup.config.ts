import { defineConfig } from "tsup";

/*
 * Entry layout (grows by phase):
 *   index  → `xenon-cms`         isomorphic core (Phase 1)
 *   next   → `xenon-cms/next`    server-only Next.js integration (Phase 2/3)
 *   client → internal `"use client"` UI bundle, imported by `next` as an external
 *            self-reference so the directive survives bundling (Phase 3)
 */
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "es2022",
  platform: "neutral",
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: true,
  external: ["zod", "react", "react-dom", "next"],
});
