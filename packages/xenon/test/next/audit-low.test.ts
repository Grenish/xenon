import { describe, expect, test } from "bun:test";
import { memoryAdapter } from "../../src/adapters/memory";
import { resolveUser, safeEqual } from "../../src/auth";
import { defineCollection, defineConfig, number, text } from "../../src/index";
import { createXenon } from "../../src/server/xenon";
import { listAllUsers } from "../../src/next/admin/action";
import { resolveAdminSort } from "../../src/next/admin/page";
import { acquireColorScheme, applyColorScheme } from "../../src/ui/admin/theme-store";
import { numberInputValue } from "../../src/ui/form/basic-fields";
import { resolveSelectedMedia } from "../../src/ui/form/media-field";
import type { DocSummary } from "../../src/ui/shared/services";

describe("Low #23: NumberField guards non-finite values", () => {
  test("passes finite numbers through and turns NaN/Infinity/nullish into empty string", () => {
    expect(numberInputValue(0)).toBe(0);
    expect(numberInputValue(-42.5)).toBe(-42.5);
    expect(numberInputValue(Number.NaN)).toBe("");
    expect(numberInputValue(Number.POSITIVE_INFINITY)).toBe("");
    expect(numberInputValue(Number.NEGATIVE_INFINITY)).toBe("");
    expect(numberInputValue(null)).toBe("");
    expect(numberInputValue(undefined)).toBe("");
    expect(numberInputValue("123")).toBe("");
  });
});

describe("Low #25: MediaField preserves selected IDs while summaries are loading", () => {
  test("retains all IDs in order with loading placeholder while loading, and unavailable once loaded", () => {
    const whileLoading = resolveSelectedMedia(["img-1", "img-2"], [], true);
    expect(whileLoading.map((d) => d.id)).toEqual(["img-1", "img-2"]);
    expect(whileLoading[0]?.title).toBe("Loading…");
    expect(whileLoading[1]?.title).toBe("Loading…");

    const afterLoad = resolveSelectedMedia(["img-1", "img-2"], [], false);
    expect(afterLoad.map((d) => d.id)).toEqual(["img-1", "img-2"]);
    expect(afterLoad[0]?.title).toBe("Unavailable file");
  });

  test("merges loaded summaries while preserving order and unresolved IDs", () => {
    const loaded: DocSummary[] = [
      { id: "img-2", title: "Second", status: "published", updatedAt: "2026-01-02T00:00:00.000Z", url: "/b.png", mimeType: "image/png" },
    ];
    const resolved = resolveSelectedMedia(["img-1", "img-2", "img-3"], loaded, false);
    expect(resolved.map((d) => d.id)).toEqual(["img-1", "img-2", "img-3"]);
    expect(resolved[1]?.title).toBe("Second");
    expect(resolved[0]?.title).toBe("Unavailable file");
    expect(resolved[2]?.title).toBe("Unavailable file");
  });
});

describe("Low #26: Admin collection sort accepts hyphenated declared fields and rejects unknown keys", () => {
  const articles = defineCollection({
    slug: "articles",
    fields: {
      title: text({ required: true }),
      "published-at": text(),
      "view-count": number(),
    },
  });
  const media = defineCollection({
    slug: "media",
    upload: true,
    fields: { alt: text() },
  });

  test("accepts hyphenated declared fields, system keys, and upload keys only on upload collections", () => {
    expect(resolveAdminSort(articles, "published-at")).toBe("published-at");
    expect(resolveAdminSort(articles, "-published-at")).toBe("-published-at");
    expect(resolveAdminSort(articles, "-view-count")).toBe("-view-count");
    expect(resolveAdminSort(articles, "createdAt")).toBe("createdAt");
    expect(resolveAdminSort(media, "-filesize")).toBe("-filesize");
    expect(resolveAdminSort(articles, "-filesize")).toBe("-updatedAt");
  });

  test("falls back to -updatedAt on unknown, empty, or prototype keys", () => {
    expect(resolveAdminSort(articles, undefined)).toBe("-updatedAt");
    expect(resolveAdminSort(articles, "")).toBe("-updatedAt");
    expect(resolveAdminSort(articles, "-")).toBe("-updatedAt");
    expect(resolveAdminSort(articles, "nonexistent")).toBe("-updatedAt");
    expect(resolveAdminSort(articles, "__proto__")).toBe("-updatedAt");
    expect(resolveAdminSort(articles, "constructor")).toBe("-updatedAt");
  });
});

describe("Low #27: AdminRoot colorScheme reference counting under theme toggles and cacheComponents", () => {
  test("restores the host page's true original colorScheme after toggling themes", () => {
    const fakeRoot = { style: { colorScheme: "only light" } };
    const release = acquireColorScheme(fakeRoot);
    applyColorScheme(fakeRoot, false);
    expect(fakeRoot.style.colorScheme).toBe("light");
    applyColorScheme(fakeRoot, true);
    expect(fakeRoot.style.colorScheme).toBe("dark");
    applyColorScheme(fakeRoot, false);
    expect(fakeRoot.style.colorScheme).toBe("light");
    release();
    expect(fakeRoot.style.colorScheme).toBe("only light");
  });

  test("keeps active colorScheme when multiple AdminRoots overlap and restores only when the last unmounts", () => {
    const fakeRoot = { style: { colorScheme: "" } };
    const releaseA = acquireColorScheme(fakeRoot);
    applyColorScheme(fakeRoot, true);
    expect(fakeRoot.style.colorScheme).toBe("dark");

    // Second cached route mounts while root already has "dark"
    const releaseB = acquireColorScheme(fakeRoot);
    applyColorScheme(fakeRoot, true);

    // First route unmounts; second is still active so "dark" stays applied
    releaseA();
    releaseA(); // idempotent double-release
    expect(fakeRoot.style.colorScheme).toBe("dark");

    // User switches theme while only B is mounted
    applyColorScheme(fakeRoot, false);
    expect(fakeRoot.style.colorScheme).toBe("light");

    // Last AdminRoot unmounts; host original "" is restored
    releaseB();
    expect(fakeRoot.style.colorScheme).toBe("");
  });
});

describe("Low #28a: users.list paginates past 200 users", () => {
  test("fetches every page until total is reached without silently truncating", async () => {
    const all = Array.from({ length: 5 }, (_, i) => ({
      id: `u-${i + 1}`,
      email: `user${i + 1}@example.com`,
      name: `User ${i + 1}`,
      role: i === 0 ? "admin" : "editor",
      createdAt: new Date(Date.UTC(2026, 0, i + 1)),
    }));
    const calls: Array<{ limit: number; offset: number }> = [];
    const users = await listAllUsers(
      async ({ query }) => {
        calls.push({ limit: query.limit, offset: query.offset });
        return { users: all.slice(query.offset, query.offset + query.limit), total: all.length };
      },
      new Headers(),
      2,
    );
    expect(calls).toEqual([
      { limit: 2, offset: 0 },
      { limit: 2, offset: 2 },
      { limit: 2, offset: 4 },
    ]);
    expect(users.map((u) => u.id)).toEqual(["u-1", "u-2", "u-3", "u-4", "u-5"]);
    expect(users[0]?.role).toBe("admin");
    expect(users[1]?.role).toBe("editor");
  });

  test("dedupes overlapping IDs across page boundaries with tied createdAt and sorts deterministically by createdAt, id", async () => {
    const sameInstant = new Date("2026-01-01T00:00:00.000Z");
    const pages = [
      [
        { id: "u-b", email: "b@example.com", role: "editor", createdAt: sameInstant },
        { id: "u-a", email: "a@example.com", role: "admin", createdAt: sameInstant },
      ],
      // Simulated offset shift repeats u-b across the boundary and adds u-c at the same millisecond
      [
        { id: "u-b", email: "b@example.com", role: "editor", createdAt: sameInstant },
        { id: "u-c", email: "c@example.com", role: "editor", createdAt: sameInstant },
      ],
      [],
    ];
    let pageIdx = 0;
    const users = await listAllUsers(
      async () => ({ users: pages[pageIdx++] ?? [], total: 4 }),
      new Headers(),
      2,
    );
    expect(users.map((u) => u.id)).toEqual(["u-a", "u-b", "u-c"]);
  });

  test("respects maxUsers safety ceiling and warns instead of truncating silently", async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
    try {
      const users = await listAllUsers(
        async ({ query }) => ({
          users: Array.from({ length: query.limit }, (_, i) => ({
            id: `u-${query.offset + i}`,
            email: `u${query.offset + i}@example.com`,
            role: "editor",
            createdAt: "2026-01-01T00:00:00.000Z",
          })),
          total: 100,
        }),
        new Headers(),
        3,
        5,
      );
      expect(users).toHaveLength(5);
      expect(warnings.some((w) => w.includes("maximum safety limit (5)"))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("Low #28b: constant-time length-hiding API key comparison", () => {
  test("safeEqual compares equal, unequal, different-length, empty, and Unicode strings", () => {
    expect(safeEqual("secret-key-123", "secret-key-123")).toBe(true);
    expect(safeEqual("secret-key-123", "secret-key-124")).toBe(false);
    expect(safeEqual("short", "much-longer-secret-key")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("", "a")).toBe(false);
    expect(safeEqual("鍵-🔑", "鍵-🔑")).toBe(true);
    expect(safeEqual("鍵-🔑", "鍵-🔐")).toBe(false);
  });

  test("resolveUser matches keys across all lengths and never downgrades invalid Bearer token", async () => {
    const cfg = defineConfig({
      collections: [defineCollection({ slug: "posts", fields: { title: text() } })],
      db: memoryAdapter(),
      auth: {
        secret: "test-secret-0123456789abcdef0123456789abcdef",
        apiKeys: [
          { key: "short-key", role: "editor", name: "ci" },
          { key: "very-long-production-admin-key-0123456789", role: "admin", name: "ops" },
        ],
      },
    });
    const editor = await resolveUser(cfg, null, new Headers({ authorization: "Bearer short-key" }));
    expect(editor).toEqual({ id: "apikey:ci", email: "", name: "ci", role: "editor" });

    const admin = await resolveUser(cfg, null, new Headers({ authorization: "Bearer very-long-production-admin-key-0123456789" }));
    expect(admin).toEqual({ id: "apikey:ops", email: "", name: "ops", role: "admin" });

    const invalid = await resolveUser(cfg, null, new Headers({ authorization: "Bearer wrong" }));
    expect(invalid).toBeNull();
  });
});

describe("Non-ASCII slug URL round-trip (playground route parity)", () => {
  test("percent-encoded non-ASCII route param decodes and resolves via findBySlug", async () => {
    const cfg = defineConfig({
      collections: [defineCollection({ slug: "posts", slugFrom: "title", fields: { title: text({ required: true }) } })],
      db: memoryAdapter(),
    });
    const xenon = createXenon(cfg);
    const created = await xenon.create({ collection: "posts", data: { title: "日本語のタイトル" } });
    expect(created.slug).toBe("日本語のタイトル");

    const encodedParam = encodeURIComponent(created.slug!);
    expect(encodedParam).not.toBe(created.slug);
    const found = await xenon.findBySlug({ collection: "posts", slug: decodeURIComponent(encodedParam) });
    expect(found?.id).toBe(created.id);
  });
});
