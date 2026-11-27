import { afterAll, describe, expect, test } from "bun:test";
import type { DatabaseAdapter, FindArgs } from "../../src/adapters/types";
import { memoryAdapter } from "../../src/adapters/memory";
import { pgliteAdapter } from "../../src/adapters/postgres/pglite";
import {
  array,
  blocks,
  boolean,
  buildGlobalSchema,
  defineBlock,
  defineCollection,
  defineConfig,
  defineGlobal,
  getGlobal,
  group,
  isXenonError,
  media,
  relation,
  text,
  textarea,
  validateGlobalData,
  XenonConfigError,
} from "../../src/index";
import { LocalStorageAdapter } from "../../src/storage/local";
import { createXenon } from "../../src/server";
import type { XenonChangeEvent } from "../../src/server/types";
import { xenonTags } from "../../src/next/xenon";
import { GLOBALS_COLLECTION } from "../../src/core/types";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const uploadDir = mkdtempSync(join(tmpdir(), "xenon-globals-test-"));
afterAll(() => {
  rmSync(uploadDir, { recursive: true, force: true });
});

const PNG_1X1 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const mediaColl = defineCollection({
  slug: "media",
  upload: true,
  fields: {
    alt: text({ required: true }),
  },
});

const authors = defineCollection({
  slug: "authors",
  fields: {
    name: text({ required: true }),
    avatar: media({ relationTo: "media" }),
  },
});

const pages = defineCollection({
  slug: "pages",
  slugFrom: "title",
  fields: {
    title: text({ required: true }),
    author: relation({ relationTo: "authors" }),
  },
});

const restrictedColl = defineCollection({
  slug: "secrets",
  fields: {
    label: text({ required: true }),
  },
  access: {
    read: ({ user }) => user?.role === "admin",
  },
});

const ctaBlock = defineBlock({
  slug: "cta",
  fields: {
    heading: text({ required: true }),
    page: relation({ relationTo: "pages" }),
  },
});

const siteSettings = defineGlobal({
  slug: "site-settings",
  label: "Site Settings",
  fields: {
    siteName: text({ required: true }),
    tagline: text({ defaultValue: "Hello Xenon" }),
    maintenance: boolean({ defaultValue: false }),
    logo: media({ relationTo: "media" }),
    homePage: relation({ relationTo: "pages" }),
    featuredPages: relation({ relationTo: "pages", hasMany: true }),
    secretRef: relation({ relationTo: "secrets" }),
    seo: group({
      fields: {
        titleSuffix: text({ defaultValue: " | Xenon" }),
        description: textarea(),
        ogImage: media({ relationTo: "media" }),
      },
    }),
    nav: array({
      fields: {
        label: text({ required: true }),
        page: relation({ relationTo: "pages" }),
      },
    }),
    banners: blocks({ blocks: [ctaBlock] }),
  },
});

const footer = defineGlobal({
  slug: "footer",
  label: "Footer",
  drafts: false,
  fields: {
    copyright: text({ required: true }),
  },
});

const privateGlobal = defineGlobal({
  slug: "internal-flags",
  label: "Internal Flags",
  fields: {
    beta: boolean({ defaultValue: false }),
  },
  access: {
    read: ({ user }) => user?.role === "admin",
    update: ({ user }) => user?.role === "admin",
  },
});

describe("defineGlobal & defineConfig validation", () => {
  test("reserves 'globals' collection slug to avoid REST collision", () => {
    const bad = defineCollection({ slug: "globals", fields: { title: text() } });
    expect(() => defineConfig({ collections: [bad] })).toThrow(XenonConfigError);
  });

  test("rejects invalid global slugs and duplicate global slugs", () => {
    expect(() =>
      defineConfig({
        collections: [mediaColl, authors, pages],
        globals: [defineGlobal({ slug: "SiteSettings", fields: { name: text() } })],
      }),
    ).toThrow(XenonConfigError);
    expect(() =>
      defineConfig({
        collections: [mediaColl, authors, pages],
        globals: [defineGlobal({ slug: "_internal", fields: { name: text() } })],
      }),
    ).toThrow(XenonConfigError);
    expect(() =>
      defineConfig({
        collections: [mediaColl, authors, pages],
        globals: [
          defineGlobal({ slug: "settings", fields: { name: text() } }),
          defineGlobal({ slug: "settings", fields: { other: text() } }),
        ],
      }),
    ).toThrow(XenonConfigError);
  });

  test("validates global fields, relation targets, reserved keys, and forbids indexes", () => {
    expect(() =>
      defineConfig({
        collections: [mediaColl, authors, pages],
        globals: [defineGlobal({ slug: "bad-rel", fields: { ref: relation({ relationTo: "nope" }) } })],
      }),
    ).toThrow(/global "bad-rel"/);

    expect(() =>
      defineConfig({
        collections: [mediaColl, authors, pages],
        globals: [defineGlobal({ slug: "bad-media", fields: { img: media({ relationTo: "pages" }) } })],
      }),
    ).toThrow(/global "bad-media"/);

    expect(() =>
      defineConfig({
        collections: [mediaColl, authors, pages],
        globals: [defineGlobal({ slug: "bad-key", fields: { id: text() } })],
      }),
    ).toThrow(/global "bad-key"/);

    expect(() =>
      defineConfig({
        collections: [mediaColl, authors, pages],
        globals: [defineGlobal({ slug: "bad-idx", fields: { title: text({ index: true }) } })],
      }),
    ).toThrow(/index is not supported on global fields/);

    expect(() =>
      defineConfig({
        collections: [mediaColl, authors, pages],
        globals: [
          defineGlobal({
            slug: "bad-uniq",
            fields: { seo: group({ fields: { key: text({ unique: true }) } }) },
          }),
        ],
      }),
    ).toThrow(/unique is not supported on global fields/);
  });

  test("getGlobal, buildGlobalSchema, and validateGlobalData work cleanly", () => {
    const cfg = defineConfig({ collections: [mediaColl, authors, pages, restrictedColl], globals: [siteSettings, footer] });
    expect(getGlobal(cfg, "site-settings")).toBe(siteSettings);
    expect(getGlobal(cfg, "missing")).toBeUndefined();
    expect(xenonTags.global("site-settings")).toBe("xenon:global:site-settings");

    const draftOk = validateGlobalData(siteSettings, { tagline: "WIP" }, { mode: "draft" });
    expect(draftOk.success).toBe(true);

    const createFail = validateGlobalData(siteSettings, { tagline: "Missing siteName" }, { mode: "create" });
    expect(createFail.success).toBe(false);

    const schema = buildGlobalSchema(footer, { mode: "create" });
    expect(schema.safeParse({ copyright: "2026" }).success).toBe(true);
    expect(schema.safeParse({ copyright: "2026", extra: 1 }).success).toBe(false);
  });
});

const adapters: [string, () => DatabaseAdapter][] = [
  ["memory", () => memoryAdapter()],
  ["pglite", () => pgliteAdapter()],
];

for (const [adapterName, createDb] of adapters) {
  describe(`Local API globals (${adapterName})`, () => {
    test("draft/publish/unpublish lifecycle, defaults, partial group merges, and cache events", async () => {
      const db = createDb();
      const events: XenonChangeEvent[] = [];
      const config = defineConfig({
        collections: [mediaColl, authors, pages, restrictedColl],
        globals: [siteSettings, footer, privateGlobal],
        db,
        storage: new LocalStorageAdapter({ directory: uploadDir }),
      });
      const xenon = createXenon(config, { onChange: (e) => { events.push(e); } });

      // Never saved yet -> null for both live and draft reads.
      expect(await xenon.getGlobal({ slug: "site-settings" })).toBeNull();
      expect(await xenon.getGlobal({ slug: "site-settings", draft: true })).toBeNull();

      // First save as draft (required siteName omitted).
      const draft1 = await xenon.updateGlobal({
        slug: "site-settings",
        data: { tagline: "Draft tagline", seo: { description: "Meta desc" } },
        draft: true,
      });
      expect(draft1.slug).toBe("site-settings");
      expect(draft1.status).toBe("draft");
      expect(draft1.tagline).toBe("Draft tagline");
      expect(draft1.seo.titleSuffix).toBe(" | Xenon");
      expect(draft1.seo.description).toBe("Meta desc");

      // Still unpublished -> live read is null; draft read sees the draft.
      expect(await xenon.getGlobal({ slug: "site-settings" })).toBeNull();
      const readDraft = await xenon.getGlobal({ slug: "site-settings", draft: true });
      expect(readDraft?.tagline).toBe("Draft tagline");

      // Publishing without required siteName fails validation.
      await expect(
        xenon.updateGlobal({ slug: "site-settings", data: { tagline: "Still missing name" } }),
      ).rejects.toMatchObject({ code: "VALIDATION" });

      // Publishing merges with draft working copy & applies defaults.
      const published = await xenon.updateGlobal({
        slug: "site-settings",
        data: { siteName: "Xenon News" },
      });
      expect(published.status).toBe("published");
      expect(published.siteName).toBe("Xenon News");
      expect(published.tagline).toBe("Draft tagline");
      expect(published.seo.description).toBe("Meta desc");
      expect(published.maintenance).toBe(false);

      // Draft edit after publish leaves live version untouched and merges groups recursively.
      const draft2 = await xenon.updateGlobal({
        slug: "site-settings",
        data: { tagline: "Upcoming tagline", seo: { titleSuffix: " — Next" } },
        draft: true,
      });
      expect(draft2.status).toBe("published");
      expect(draft2.tagline).toBe("Upcoming tagline");
      expect(draft2.seo.titleSuffix).toBe(" — Next");
      expect(draft2.seo.description).toBe("Meta desc");

      const live = await xenon.getGlobal({ slug: "site-settings" });
      expect(live?.tagline).toBe("Draft tagline");
      expect(live?.seo.titleSuffix).toBe(" | Xenon");

      const working = await xenon.getGlobal({ slug: "site-settings", draft: true });
      expect(working?.tagline).toBe("Upcoming tagline");
      expect(working?.seo.titleSuffix).toBe(" — Next");

      // Unpublish hides live global while preserving working copy in draft.
      const unpub = await xenon.unpublishGlobal({ slug: "site-settings" });
      expect(unpub.status).toBe("draft");
      expect(unpub.tagline).toBe("Upcoming tagline");
      expect(await xenon.getGlobal({ slug: "site-settings" })).toBeNull();
      expect((await xenon.getGlobal({ slug: "site-settings", draft: true }))?.tagline).toBe("Upcoming tagline");

      // drafts: false publishes even when draft: true is passed, and rejects unpublishGlobal.
      const savedFooter = await xenon.updateGlobal({
        slug: "footer",
        data: { copyright: "2026 Xenon" },
        draft: true,
      });
      expect(savedFooter.status).toBe("published");
      expect((await xenon.getGlobal({ slug: "footer" }))?.copyright).toBe("2026 Xenon");
      await expect(xenon.unpublishGlobal({ slug: "footer" })).rejects.toMatchObject({ code: "BAD_REQUEST" });

      // Never-saved global cannot be unpublished.
      await expect(xenon.unpublishGlobal({ slug: "internal-flags" })).rejects.toMatchObject({ code: "NOT_FOUND" });

      // Verify onChange events recorded global slug & draft flags accurately.
      expect(events.map((e) => [e.collection, e.global, e.op, e.draft])).toEqual([
        [GLOBALS_COLLECTION, "site-settings", "update", true],
        [GLOBALS_COLLECTION, "site-settings", "update", false],
        [GLOBALS_COLLECTION, "site-settings", "update", true],
        [GLOBALS_COLLECTION, "site-settings", "unpublish", false],
        [GLOBALS_COLLECTION, "footer", "update", false],
      ]);

      // Zero leakage into user collections.
      const pagesRes = await xenon.find({ collection: "pages", draft: true });
      expect(pagesRes.totalDocs).toBe(0);

      await db.close?.();
    });

    test("optimistic concurrency (expectedUpdatedAt) and concurrent first-write safety", async () => {
      const db = createDb();
      const xenon = createXenon(defineConfig({ collections: [mediaColl, authors, pages], globals: [footer], db }));

      // Passing expectedUpdatedAt when row doesn't exist yet -> CONFLICT.
      await expect(
        xenon.updateGlobal({
          slug: "footer",
          data: { copyright: "2026" },
          expectedUpdatedAt: new Date().toISOString(),
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      // Concurrent first-time writes converge cleanly to one row without SlugConflictError.
      const [a, b] = await Promise.all([
        xenon.updateGlobal({ slug: "footer", data: { copyright: "First" } }),
        xenon.updateGlobal({ slug: "footer", data: { copyright: "Second" } }),
      ]);
      expect(a.id).toBe(b.id);
      const allGlobalRows = await db.find({ collection: GLOBALS_COLLECTION, source: "draft", limit: 10 });
      expect(allGlobalRows.totalDocs).toBe(1);

      const latest = (await xenon.getGlobal({ slug: "footer" }))!;
      const updated = await xenon.updateGlobal({
        slug: "footer",
        data: { copyright: "Third" },
        expectedUpdatedAt: latest.updatedAt,
      });
      expect(updated.copyright).toBe("Third");

      // Stale timestamp fails with CONFLICT and updatedAt issue path.
      try {
        await xenon.updateGlobal({
          slug: "footer",
          data: { copyright: "Stale" },
          expectedUpdatedAt: latest.updatedAt,
        });
        throw new Error("Expected conflict");
      } catch (err) {
        expect(isXenonError(err)).toBe(true);
        if (isXenonError(err)) {
          expect(err.code).toBe("CONFLICT");
          expect(err.issues?.[0]?.path).toEqual(["updatedAt"]);
        }
      }

      await db.close?.();
    });

    test("select, batched populate (including group/array/blocks), and access enforcement", async () => {
      const rawDb = createDb();
      const findCalls: FindArgs[] = [];
      const origFind = rawDb.find.bind(rawDb);
      rawDb.find = async (args) => {
        findCalls.push(args);
        return origFind(args);
      };
      const db = rawDb;
      const xenon = createXenon(
        defineConfig({
          collections: [mediaColl, authors, pages, restrictedColl],
          globals: [siteSettings, privateGlobal],
          db,
          storage: new LocalStorageAdapter({ directory: uploadDir }),
        }),
      );

      const logo = await xenon.create({
        collection: "media",
        data: { alt: "Brand logo" },
        file: { data: PNG_1X1, name: "logo.png", type: "image/png" },
      });
      const avatar = await xenon.create({
        collection: "media",
        data: { alt: "Author avatar" },
        file: { data: PNG_1X1, name: "avatar.png", type: "image/png" },
      });
      const author = await xenon.create({
        collection: "authors",
        data: { name: "Ada", avatar: avatar.id },
      });
      const p1 = await xenon.create({ collection: "pages", data: { title: "Home", author: author.id } });
      const p2 = await xenon.create({ collection: "pages", data: { title: "About", author: author.id } });
      const secret = await xenon.create({ collection: "secrets", data: { label: "Top Secret" } });

      await xenon.updateGlobal({
        slug: "site-settings",
        data: {
          siteName: "Acme",
          logo: logo.id,
          homePage: p1.id,
          featuredPages: [p1.id, p2.id, "missing-id"],
          secretRef: secret.id,
          seo: { titleSuffix: " — Acme", ogImage: logo.id },
          nav: [
            { label: "Home", page: p1.id },
            { label: "About", page: p2.id },
          ],
          banners: [{ blockType: "cta", heading: "Read more", page: p2.id }],
        },
      });

      // Reset query counter and run a deep select + populate query.
      findCalls.length = 0;
      const populated = await xenon.getGlobal({
        slug: "site-settings",
        select: { siteName: true, seo: { titleSuffix: true } },
        populate: {
          logo: { select: { alt: true, url: true } },
          homePage: { select: { title: true }, populate: { author: { select: { name: true }, populate: { avatar: { select: { alt: true } } } } } },
          featuredPages: { select: { title: true } },
          seo: { ogImage: { select: { alt: true } } },
          nav: { page: { select: { title: true } } },
          banners: { cta: { page: { select: { title: true } } } },
        },
      });

      expect(populated).not.toBeNull();
      expect(Object.keys(populated!).sort()).toEqual(["banners", "featuredPages", "homePage", "id", "logo", "nav", "seo", "siteName"]);
      expect(populated!.logo).toEqual({ id: logo.id, alt: "Brand logo", url: logo.url });
      expect(populated!.homePage).toEqual({
        id: p1.id,
        title: "Home",
        author: { id: author.id, name: "Ada", avatar: { id: avatar.id, alt: "Author avatar" } },
      });
      // Missing id filtered out of hasMany array.
      expect(populated!.featuredPages).toEqual([
        { id: p1.id, title: "Home" },
        { id: p2.id, title: "About" },
      ]);
      expect(populated!.seo).toEqual({ titleSuffix: " — Acme", ogImage: { id: logo.id, alt: "Brand logo" } });
      expect(populated!.nav.map((item) => item.page?.title)).toEqual(["Home", "About"]);
      expect(populated!.banners[0]?.page).toEqual({ id: p2.id, title: "About" });

      // Batched queries: 1 global lookup + 1 media (depth 0) + 1 pages (depth 0) + 1 authors (depth 1) + 1 media (depth 2: avatar not yet cached) = 5.
      const colCounts = findCalls.reduce<Record<string, number>>((acc, c) => {
        acc[c.collection] = (acc[c.collection] ?? 0) + 1;
        return acc;
      }, {});
      expect(colCounts[GLOBALS_COLLECTION]).toBe(1);
      expect(colCounts.pages).toBe(1);
      expect(colCounts.authors).toBe(1);

      // Access control with overrideAccess: false.
      const editor = { id: "u1", email: "ed@example.com", role: "editor" as const };
      const admin = { id: "u2", email: "ad@example.com", role: "admin" as const };

      // Public read allowed for site-settings (published), draft denied for anon.
      expect(await xenon.getGlobal({ slug: "site-settings", overrideAccess: false })).not.toBeNull();
      await expect(
        xenon.getGlobal({ slug: "site-settings", draft: true, overrideAccess: false }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

      // Custom access.read / access.update on privateGlobal.
      await expect(
        xenon.updateGlobal({ slug: "internal-flags", data: { beta: true }, user: editor, overrideAccess: false }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await xenon.updateGlobal({ slug: "internal-flags", data: { beta: true }, user: admin, overrideAccess: false });
      await expect(
        xenon.getGlobal({ slug: "internal-flags", user: editor, overrideAccess: false }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await xenon.getGlobal({ slug: "internal-flags", user: admin, overrideAccess: false }))?.beta).toBe(true);

      // Populating a restricted collection checks target collection's access.read.
      await expect(
        xenon.getGlobal({
          slug: "site-settings",
          populate: { secretRef: true },
          user: editor,
          overrideAccess: false,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const withSecret = await xenon.getGlobal({
        slug: "site-settings",
        populate: { secretRef: true },
        user: admin,
        overrideAccess: false,
      });
      expect(withSecret?.secretRef?.label).toBe("Top Secret");

      await rawDb.close?.();
    });
  });
}
