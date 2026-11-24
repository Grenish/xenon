#!/usr/bin/env bun
/**
 * Reproducible XenonCMS benchmarks: package weight, install footprint, cold start and query latency.
 *
 *   bun run build && bun run bench                 # everything (install step needs network)
 *   bun run bench -- --no-install --runs 5         # quicker, offline
 *   bun run bench -- --json out.json --markdown summary.md
 *   bun run bench -- --postgres postgres://…       # also measure a real PostgreSQL (or set BENCH_DATABASE_URL)
 *
 * Measures the built package in packages/xenon/dist, so run `bun run build` first. Data and query mix are
 * seeded from a fixed PRNG, so runs on the same machine are comparable; numbers across machines are not.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync, appendFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { formatBytes, formatMs, markdownTable, parseArgs, rng, type Stats, summarize } from "./bench-lib";

const root = resolve(import.meta.dir, "..");
const xenonDir = join(root, "packages/xenon");
const dist = join(xenonDir, "dist");
const options = parseArgs(process.argv.slice(2), process.env);

if (!existsSync(join(dist, "server.js"))) {
  console.error("packages/xenon/dist is missing. Run `bun run build` first.");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(xenonDir, "package.json"), "utf8")) as { name: string; version: string };
const results: Record<string, unknown> = {
  package: `${pkg.name}@${pkg.version}`,
  date: new Date().toISOString(),
  environment: { bun: Bun.version, node: nodeVersion(), platform: `${process.platform}-${process.arch}` },
  options,
};
const markdown: string[] = [`## XenonCMS benchmarks (${pkg.name}@${pkg.version})`];

function log(line = "") {
  console.log(line);
}

function nodeVersion(): string | null {
  const out = spawnSync("node", ["--version"], { encoding: "utf8" });
  return out.status === 0 ? out.stdout.trim() : null;
}

function run(cmd: string, args: string[], cwd: string): string {
  const out = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, npm_config_update_notifier: "false" } });
  if (out.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${out.status}):\n${out.stderr || out.stdout}`);
  return out.stdout;
}

interface PackResult { size: number; unpackedSize: number; entryCount: number; filename: string; files: { path: string; size: number }[] }

/** `npm pack --json` prints an array (npm ≤ 11) or an object keyed by package name (npm 12+). */
function npmPack(cwd: string, extra: string[]): PackResult {
  const parsed = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", ...extra], cwd)) as PackResult[] | Record<string, PackResult>;
  const result = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  if (!result) throw new Error(`npm pack returned nothing in ${cwd}`);
  return result;
}

/** The entry file plus every dist-local module it statically imports, transitively. */
function localImportClosure(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file) || !existsSync(join(dist, file))) return;
    seen.add(file);
    const code = readFileSync(join(dist, file), "utf8");
    for (const match of code.matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/g)) visit(match[1]!);
  };
  visit(entry);
  return [...seen];
}

function dirSize(path: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  const walk = (p: string) => {
    const stat = lstatSync(p);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const entry of readdirSync(p)) walk(join(p, entry));
    } else {
      bytes += stat.size;
      files++;
    }
  };
  walk(path);
  return { bytes, files };
}

// ---------------------------------------------------------------------------------------------
// 1. Package weight: what `npm publish` ships, and the admin UI share of it (the baseline that a
//    future prebuilt admin SPA adds to).
// ---------------------------------------------------------------------------------------------
function packageWeight() {
  const packed = npmPack(xenonDir, ["--dry-run"]);
  const files = packed.files;
  const sum = (filter: (path: string) => boolean) => files.filter((f) => filter(f.path)).reduce((n, f) => n + f.size, 0);
  const gz = (rel: string) => (existsSync(join(xenonDir, rel)) ? gzipSync(readFileSync(join(xenonDir, rel))).length : 0);
  const raw = (rel: string) => (existsSync(join(xenonDir, rel)) ? statSync(join(xenonDir, rel)).size : 0);
  const sourceMaps = sum((p) => p.endsWith(".map"));
  const fonts = sum((p) => p.startsWith("dist/fonts/"));
  const js = files.filter((f) => f.path.endsWith(".js"));
  const jsGzip = js.reduce((n, f) => n + gz(f.path), 0);
  const admin = {
    clientJs: { raw: raw("dist/client.js"), gzip: gz("dist/client.js") },
    stylesCss: { raw: raw("dist/styles.css"), gzip: gz("dist/styles.css") },
    fonts,
  };
  // Entries are thin re-exports of shared chunks, so measure each one with every local chunk it pulls in.
  const entries = ["index", "server", "next", "react", "postgres", "pglite", "drizzle", "memory"].map((name) => {
    const closure = localImportClosure(`${name}.js`);
    const code = Buffer.concat(closure.map((file) => readFileSync(join(dist, file))));
    return { name, files: closure.length, raw: code.length, gzip: gzipSync(code).length };
  });
  const weight = {
    tarball: packed.size, unpacked: packed.unpackedSize, files: packed.entryCount, sourceMaps, jsGzipTotal: jsGzip, admin, entries,
  };
  results.packageWeight = weight;

  log("Package weight");
  log(`  tarball ${formatBytes(weight.tarball)} · unpacked ${formatBytes(weight.unpacked)} · ${weight.files} files`);
  log(`  of which source maps ${formatBytes(sourceMaps)}, fonts ${formatBytes(fonts)}; all JS gzipped ${formatBytes(jsGzip)}`);
  log(`  admin UI: client.js ${formatBytes(admin.clientJs.raw)} (${formatBytes(admin.clientJs.gzip)} gz), styles.css ${formatBytes(admin.stylesCss.raw)} (${formatBytes(admin.stylesCss.gzip)} gz)`);
  markdown.push(
    "### Package weight",
    markdownTable(["metric", "size"], [
      ["tarball", formatBytes(weight.tarball)],
      ["unpacked", `${formatBytes(weight.unpacked)} (${weight.files} files)`],
      ["source maps (unpacked)", formatBytes(sourceMaps)],
      ["fonts (unpacked)", formatBytes(fonts)],
      ["all JS, gzipped", formatBytes(jsGzip)],
      ["admin `client.js`", `${formatBytes(admin.clientJs.raw)} · ${formatBytes(admin.clientJs.gzip)} gz`],
      ["admin `styles.css`", `${formatBytes(admin.stylesCss.raw)} · ${formatBytes(admin.stylesCss.gzip)} gz`],
      ...entries.map((e) => [`\`xenon-cms/${e.name === "index" ? "" : e.name}\` (with its chunks)`, `${formatBytes(e.raw)} · ${formatBytes(e.gzip)} gz`]),
    ]),
  );

  const cxa = join(root, "packages/create-xenon-app");
  if (existsSync(join(cxa, "package.json"))) {
    try {
      const p = npmPack(cxa, ["--dry-run"]);
      results.createXenonApp = { tarball: p.size, unpacked: p.unpackedSize, files: p.entryCount };
      log(`  create-xenon-app: tarball ${formatBytes(p.size)} · unpacked ${formatBytes(p.unpackedSize)}`);
      markdown.push("", markdownTable(["create-xenon-app", "size"], [["tarball", formatBytes(p.size)], ["unpacked", formatBytes(p.unpackedSize)]]));
    } catch (error) {
      log(`  create-xenon-app: skipped (${(error as Error).message.split("\n")[0]})`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 2. Install footprint: `npm install` of the packed tarball into an empty project, peers omitted
//    (a Next/React app already has them), so this is what Xenon adds to node_modules.
// ---------------------------------------------------------------------------------------------
function installFootprint() {
  const dir = mkdtempSync(join(tmpdir(), "xenon-bench-install-"));
  try {
    const packed = npmPack(xenonDir, ["--pack-destination", dir]);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "bench-consumer", private: true, type: "module" }));
    const started = performance.now();
    run("npm", ["install", join(dir, packed.filename), "--omit=peer", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts", "--loglevel=error"], dir);
    const seconds = (performance.now() - started) / 1000;
    const nm = join(dir, "node_modules");
    const size = dirSize(nm);
    const lock = JSON.parse(readFileSync(join(nm, ".package-lock.json"), "utf8")) as { packages: Record<string, unknown> };
    const packages = Object.keys(lock.packages).filter((k) => k.startsWith("node_modules/")).length;
    results.install = { nodeModules: size.bytes, files: size.files, packages, seconds };
    log("Install footprint (npm, peers omitted)");
    log(`  node_modules ${formatBytes(size.bytes)} · ${packages} packages · ${size.files} files · ${seconds.toFixed(1)} s`);
    markdown.push("### Install footprint", "npm install of the packed tarball into an empty project, peer dependencies omitted.",
      markdownTable(["node_modules", "packages", "files"], [[formatBytes(size.bytes), String(packages), String(size.files)]]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// 3. Cold start: a fresh process imports the Local API + memory adapter, initializes, and serves
//    its first write and read. Repeated `runs` times; reports process wall time and the in-process split.
// ---------------------------------------------------------------------------------------------
function coldStart() {
  const dir = mkdtempSync(join(tmpdir(), "xenon-bench-cold-"));
  const url = (file: string) => JSON.stringify(pathToFileURL(join(dist, file)).href);
  const script = join(dir, "cold.mjs");
  writeFileSync(script, `
const t0 = performance.now();
const { defineConfig, defineCollection, text } = await import(${url("index.js")});
const { createXenon } = await import(${url("server.js")});
const { memoryAdapter } = await import(${url("memory.js")});
const t1 = performance.now();
const posts = defineCollection({ slug: "posts", slugFrom: "title", fields: { title: text({ required: true }) } });
const xenon = createXenon(defineConfig({ collections: [posts], db: memoryAdapter() }));
await xenon.init();
const t2 = performance.now();
await xenon.create({ collection: "posts", data: { title: "Hello" } });
await xenon.find({ collection: "posts" });
const t3 = performance.now();
process.stdout.write(JSON.stringify({ import: t1 - t0, init: t2 - t1, firstQuery: t3 - t2 }));
`);
  const runtimes = [["node", nodeVersion() !== null], ["bun", true]] as const;
  const out: Record<string, Record<string, Stats>> = {};
  const rows: string[][] = [];
  try {
    for (const [runtime, available] of runtimes) {
      if (!available) continue;
      const wall: number[] = [];
      const imp: number[] = [];
      const init: number[] = [];
      const first: number[] = [];
      for (let i = 0; i < options.runs; i++) {
        const started = performance.now();
        const child = spawnSync(runtime, [script], {
          encoding: "utf8",
          env: { ...process.env, NODE_ENV: "production", XENON_SECRET: "bench-secret-bench-secret-bench-secret" },
        });
        const elapsed = performance.now() - started;
        if (child.status !== 0) throw new Error(`cold start under ${runtime} failed:\n${child.stderr}`);
        const parsed = JSON.parse(child.stdout) as { import: number; init: number; firstQuery: number };
        wall.push(elapsed);
        imp.push(parsed.import);
        init.push(parsed.init);
        first.push(parsed.firstQuery);
      }
      out[runtime] = { wall: summarize(wall), import: summarize(imp), init: summarize(init), firstQuery: summarize(first) };
      const s = out[runtime]!;
      rows.push([runtime, formatMs(s.wall!.p50), formatMs(s.wall!.p95), formatMs(s.import!.p50), formatMs(s.init!.p50), formatMs(s.firstQuery!.p50)]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  results.coldStart = out;
  log(`Cold start (${options.runs} runs, memory adapter)`);
  for (const r of rows) log(`  ${r[0]}: process p50 ${r[1]} · p95 ${r[2]} · import ${r[3]} · init ${r[4]} · first write+read ${r[5]}`);
  markdown.push(`### Cold start (${options.runs} fresh processes, memory adapter)`,
    markdownTable(["runtime", "process p50", "process p95", "import p50", "init p50", "first write+read p50"], rows));
}

// ---------------------------------------------------------------------------------------------
// 4. Query latency through the Local API (validation, defaults, access checks included).
// ---------------------------------------------------------------------------------------------
async function queryLatency() {
  const { defineConfig, defineCollection, text, number, select, boolean } = await import(pathToFileURL(join(dist, "index.js")).href);
  const { createXenon } = await import(pathToFileURL(join(dist, "server.js")).href);
  const categories = ["news", "guides", "releases", "opinion", "events"] as const;
  const docs = defineCollection({
    slug: "bench-docs",
    slugFrom: "title",
    drafts: false,
    fields: {
      title: text({ required: true }),
      category: select({ options: categories }),
      views: number({ integer: true }),
      featured: boolean({ defaultValue: false }),
      body: text(),
    },
  });

  const adapters: { name: string; make: () => Promise<unknown> }[] = [
    { name: "memory", make: async () => (await import(pathToFileURL(join(dist, "memory.js")).href)).memoryAdapter() },
    { name: "pglite (in-memory)", make: async () => (await import(pathToFileURL(join(dist, "pglite.js")).href)).pgliteAdapter() },
  ];
  if (options.postgres) {
    const connectionString = options.postgres;
    adapters.push({ name: "postgres", make: async () => (await import(pathToFileURL(join(dist, "postgres.js")).href)).postgresAdapter({ connectionString }) });
  }

  const words = ["lorem", "ipsum", "xenon", "content", "typed", "schema", "draft", "publish", "editor", "media"];
  const out: Record<string, { seedDocsPerSec: number; queries: Record<string, Stats> }> = {};
  const rows: string[][] = [];
  for (const { name, make } of adapters) {
    const db = await make();
    const xenon = createXenon(defineConfig({ collections: [docs], db }));
    await xenon.init();
    // A shared Postgres may hold rows from an interrupted run.
    for (const doc of (await xenon.find({ collection: "bench-docs", limit: 0 })).docs) await xenon.delete({ collection: "bench-docs", id: doc.id });

    const random = rng(42);
    const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
    const ids: string[] = [];
    const slugs: string[] = [];
    const seedStart = performance.now();
    for (let i = 0; i < options.docs; i++) {
      const title = `${pick(words)} ${pick(words)} ${pick(words)} ${i}`;
      const doc = await xenon.create({
        collection: "bench-docs",
        data: { title, category: pick(categories), views: Math.floor(random() * 100_000), featured: random() < 0.1, body: Array.from({ length: 40 }, () => pick(words)).join(" ") },
      });
      ids.push(doc.id);
      slugs.push(doc.slug!);
    }
    const seedDocsPerSec = options.docs / ((performance.now() - seedStart) / 1000);

    const cases: Record<string, () => Promise<unknown>> = {
      "findById": () => xenon.findById({ collection: "bench-docs", id: pick(ids) }),
      "findBySlug": () => xenon.findBySlug({ collection: "bench-docs", slug: pick(slugs) }),
      "find equals + sort, limit 10": () => xenon.find({ collection: "bench-docs", where: { category: { equals: pick(categories) } }, sort: "-views", limit: 10 }),
      "find range + contains, page 2": () => xenon.find({ collection: "bench-docs", where: { views: { gte: 50_000 }, title: { contains: pick(words) } }, sort: "title", limit: 10, page: 2 }),
      "find or + in, limit 25": () => xenon.find({ collection: "bench-docs", where: { or: [{ featured: { equals: true } }, { category: { in: [pick(categories), pick(categories)] } }] }, limit: 25 }),
    };
    const queries: Record<string, Stats> = {};
    for (const [label, fn] of Object.entries(cases)) {
      for (let i = 0; i < Math.min(20, options.queries); i++) await fn(); // warm-up
      const samples: number[] = [];
      for (let i = 0; i < options.queries; i++) {
        const started = performance.now();
        await fn();
        samples.push(performance.now() - started);
      }
      queries[label] = summarize(samples);
      rows.push([name, label, formatMs(queries[label]!.p50), formatMs(queries[label]!.p95), formatMs(queries[label]!.p99)]);
    }
    out[name] = { seedDocsPerSec, queries };

    if (name === "postgres") for (const id of ids) await xenon.delete({ collection: "bench-docs", id });
    await (db as { close?: () => Promise<void> }).close?.();
  }

  results.queries = { docs: options.docs, iterations: options.queries, adapters: out };
  log(`Query latency (Local API, ${options.docs} docs, ${options.queries} iterations each)`);
  for (const [name, r] of Object.entries(out)) log(`  ${name}: seeded at ${r.seedDocsPerSec.toFixed(0)} docs/s`);
  for (const r of rows) log(`  ${r[0]} · ${r[1]}: p50 ${r[2]} · p95 ${r[3]} · p99 ${r[4]}`);
  markdown.push(`### Query latency (Local API, ${options.docs} docs, ${options.queries} iterations per query)`,
    markdownTable(["adapter", "query", "p50", "p95", "p99"], rows),
    "", markdownTable(["adapter", "seed throughput"], Object.entries(out).map(([name, r]) => [name, `${r.seedDocsPerSec.toFixed(0)} docs/s`])));
}

packageWeight();
log();
if (options.install) {
  installFootprint();
  log();
}
coldStart();
log();
await queryLatency();

markdown.push("", `_${results.date} · bun ${Bun.version} · node ${nodeVersion() ?? "n/a"} · ${process.platform}-${process.arch}_`, "");
if (options.json) writeFileSync(resolve(options.json), `${JSON.stringify(results, null, 2)}\n`);
if (options.markdown) appendFileSync(resolve(options.markdown), `${markdown.join("\n\n")}\n`);
process.exit(0);
