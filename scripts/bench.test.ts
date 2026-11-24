import { describe, expect, test } from "bun:test";
import { formatBytes, formatMs, markdownTable, parseArgs, percentile, rng, summarize } from "./bench-lib";

describe("bench helpers", () => {
  test("percentile uses nearest rank", () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile(sorted, 99)).toBe(99);
    expect(percentile(sorted, 100)).toBe(100);
    expect(percentile(sorted, 0)).toBe(1);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNaN();
  });

  test("summarize sorts its own copy", () => {
    const samples = [5, 1, 4, 2, 3];
    const s = summarize(samples);
    expect(s).toMatchObject({ n: 5, min: 1, p50: 3, max: 5, mean: 3 });
    expect(samples).toEqual([5, 1, 4, 2, 3]);
  });

  test("formatting", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatMs(0.25)).toBe("250 µs");
    expect(formatMs(12.345)).toBe("12.35 ms");
    expect(formatMs(250)).toBe("250 ms");
    expect(markdownTable(["a", "b"], [["1", "2"]])).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");
  });

  test("parseArgs", () => {
    expect(parseArgs([])).toEqual({ runs: 15, docs: 1000, queries: 300, install: true, postgres: undefined });
    expect(parseArgs(["--", "--runs", "5", "--docs=200", "--no-install", "--json", "out.json"])).toMatchObject({ runs: 5, docs: 200, install: false, json: "out.json" });
    expect(parseArgs([], { BENCH_DATABASE_URL: "postgres://x" }).postgres).toBe("postgres://x");
    expect(() => parseArgs(["--runs", "0"])).toThrow();
    expect(() => parseArgs(["--json"])).toThrow();
    expect(() => parseArgs(["--json", "--runs"])).toThrow();
    expect(() => parseArgs(["--nope"])).toThrow();
    expect(() => parseArgs(["stray"])).toThrow();
  });

  test("rng is deterministic", () => {
    const a = rng(42);
    const b = rng(42);
    const first = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(first);
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
  });
});
