/** Pure helpers for scripts/bench.ts (kept separate so they're unit-tested without running a benchmark). */

export interface Stats {
  n: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

/** Nearest-rank percentile (p in 0..100) of an ascending-sorted array. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (p <= 0) return sorted[0]!;
  if (p >= 100) return sorted[sorted.length - 1]!;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export function summarize(samples: readonly number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sorted.length ? sorted.reduce((sum, v) => sum + v, 0) / sorted.length : Number.NaN;
  return {
    n: sorted.length,
    min: sorted[0] ?? Number.NaN,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? Number.NaN,
    mean,
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "n/a";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return "n/a";
  return ms < 1 ? `${(ms * 1000).toFixed(0)} µs` : ms < 100 ? `${ms.toFixed(2)} ms` : `${ms.toFixed(0)} ms`;
}

export interface BenchOptions {
  json?: string;
  markdown?: string;
  runs: number;
  docs: number;
  queries: number;
  install: boolean;
  postgres?: string;
}

/** Parses `--flag value` / `--flag=value` / `--no-install`. Unknown flags throw so typos don't silently change a run. */
export function parseArgs(argv: readonly string[], env: Record<string, string | undefined> = {}): BenchOptions {
  const options: BenchOptions = { runs: 15, docs: 1000, queries: 300, install: true, postgres: env.BENCH_DATABASE_URL || undefined };
  const positiveInt = (name: string, raw: string | undefined) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer (got ${raw ?? "nothing"})`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") continue;
    if (arg === "--no-install") { options.install = false; continue; }
    const match = /^--([a-z]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`Unexpected argument: ${arg}`);
    const name = match[1]!;
    const value = match[2] ?? argv[++i];
    switch (name) {
      case "json": options.json = required(name, value); break;
      case "markdown": options.markdown = required(name, value); break;
      case "postgres": options.postgres = required(name, value); break;
      case "runs": options.runs = positiveInt(name, value); break;
      case "docs": options.docs = positiveInt(name, value); break;
      case "queries": options.queries = positiveInt(name, value); break;
      default: throw new Error(`Unknown option: --${name}`);
    }
  }
  return options;
}

function required(name: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) throw new Error(`--${name} needs a value`);
  return value;
}

/** Deterministic PRNG (mulberry32) so every run seeds and queries the same data. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function markdownTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}
