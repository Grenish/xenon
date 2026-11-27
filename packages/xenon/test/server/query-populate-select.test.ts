import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryAdapter } from "../../src/adapters/memory";
import { pgliteAdapter } from "../../src/adapters/postgres/pglite";
import type { DatabaseAdapter } from "../../src/adapters/types";
import { XenonConfigError } from "../../src/core/config";
import { XenonError } from "../../src/core/errors";
import {
  array,
  blocks,
  boolean,
  date,
  defineBlock,
  defineCollection,
  defineConfig,
  email,
  group,
  json,
  media,
  number,
  relation,
  richText,
  select,
  text,
  textarea,
  url,
} from "../../src/index";
import { createHandler } from "../../src/http";
import { createXenon } from "../../src/server/xenon";
import { LocalStorageAdapter } from "../../src/storage/local";

const heroBlock = defineBlock({
  slug: "hero",
  fields: {
    heading: text({ required: true }),
    image: media({ relationTo: "media" }),
  },
});

const quoteBlock = defineBlock({
  slug: "quote",
  fields: {
    body: textarea({ required: true }),
  },
});

const mediaColl = defineCollection({
  slug: "media",
  upload: true,
  fields: {
    alt: text({ required: true }),
  },
});

const authors = defineCollection({
  slug: "authors",
  slugFrom: "name",
  fields: {
    name: text({ required: true, index: true }),
    email: email({ required: true, unique: true }),
    avatar: media({ relationTo: "media" }),
  },
});

const secrets = defineCollection({
  slug: "secrets",
  fields: {
    label: text({ required: true }),
    code: text({ unique: true }),
  },
  access: {
    read: ({ user }) => user?.role === "admin",
  },
});

const posts = defineCollection({
  slug: "posts",
  slugFrom: "title",
  fields: {
    title: text({ required: true, index: true }),
    sku: text({ unique: true }),
    priority: number({ index: true }),
    body: richText(),
    author: relation({ relationTo: "authors", required: true }),
    reviewer: relation({ relationTo: "authors" }),
    cover: media({ relationTo: "media" }),
    secretRef: relation({ relationTo: "secrets" }),
    related: relation({ relationTo: "posts", hasMany: true }),
    seo: group({
      fields: {
        title: text(),
        noIndex: boolean({ defaultValue: false, index: true }),
        canonicalId: text({ unique: true }),
        ogImage: media({ relationTo: "media" }),
      },
    }),
    gallery: array({
      fields: {
        caption: text(),
        asset: media({ relationTo: "media", required: true }),
      },
    }),
    layout: blocks({ blocks: [heroBlock, quoteBlock] }),
    meta: json(),
  },
});

const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function makeConfig(db: DatabaseAdapter, storageDir: string) {
  return defineConfig({
    collections: [mediaColl, authors, secrets, posts],
    db,
    storage: new LocalStorageAdapter({ directory: storageDir }),
    auth: {
      secret: "populate-test-secret-abcdefghijklmnopqrstuvwxyz-0123456789",
      baseURL: "http://localhost:3000",
      apiKeys: [
        { key: "editor-key", role: "editor" },
        { key: "admin-key", role: "admin" },
      ],
    },
  });
}

describe("config validation for index and unique options", () => {
  const dummyTarget = defineCollection({ slug: "targets", fields: { name: text() } });

  test("accepts index/unique on scalar fields and inside group fields", () => {
    expect(() =>
      defineConfig({
        collections: [
          dummyTarget,
          defineCollection({
            slug: "valid",
            fields: {
              a: text({ index: true, unique: true }),
              b: number({ index: true }),
              c: boolean({ index: true }),
              d: select({ options: ["x", "y"], unique: true }),
              e: date({ index: true }),
              f: email({ unique: true }),
              g: url({ index: true }),
              h: relation({ relationTo: "targets", index: true }),
              grp: group({
                fields: {
                  nested: text({ unique: true }),
                  flag: boolean({ index: true }),
                },
              }),
            },
          }),
        ],
      }),
    ).not.toThrow();
  });

  test("rejects index/unique on hasMany, non-indexable types, and inside array/blocks", () => {
    const badConfigs = [
      () => defineConfig({ collections: [defineCollection({ slug: "a", fields: { tags: select({ options: ["a"], hasMany: true, index: true }) } })] }),
      () => defineConfig({ collections: [dummyTarget, defineCollection({ slug: "a", fields: { rels: relation({ relationTo: "targets", hasMany: true, unique: true }) } })] }),
      () => defineConfig({ collections: [defineCollection({ slug: "a", fields: { items: array({ fields: { sku: text({ unique: true }) } }) } })] }),
      () => defineConfig({ collections: [defineCollection({ slug: "a", fields: { layout: blocks({ blocks: [defineBlock({ slug: "b", fields: { code: text({ index: true }) } })] }) } })] }),
      () => defineConfig({ collections: [defineCollection({ slug: "a", fields: { raw: { ...json(), index: true } as any } })] }),
      () => defineConfig({ collections: [defineCollection({ slug: "a", fields: { long: { ...textarea(), unique: true } as any } })] }),
      () => defineConfig({ collections: [defineCollection({ slug: "a", fields: { body: { ...richText(), index: true } as any } })] }),
    ];
    for (const run of badConfigs) {
      expect(run).toThrow(XenonConfigError);
    }
  });
});

function runSuite(adapterName: string, createDb: () => DatabaseAdapter) {
  describe(`Local API & REST populate, select, nested where, and unique (${adapterName})`, () => {
    let dir: string;
    let db: DatabaseAdapter;
    let config: ReturnType<typeof makeConfig>;
    let xenon: ReturnType<typeof createXenon<ReturnType<typeof makeConfig>>>;
    let handler: ReturnType<typeof createHandler>;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), `xenon-qps-${adapterName}-`));
      db = createDb();
      config = makeConfig(db, dir);
      xenon = createXenon(config);
      handler = createHandler(config, { xenon });
      await xenon.init();
    });

    afterEach(async () => {
      await db.close?.();
      await rm(dir, { recursive: true, force: true });
    });

    async function uploadPng(alt: string, name = "img.png") {
      return xenon.create({
        collection: "media",
        data: { alt },
        file: { data: PNG_1X1, name, type: "image/png" },
      });
    }

    function req(path: string, init: RequestInit = {}, token?: string) {
      const headers = new Headers(init.headers);
      if (token) headers.set("authorization", `Bearer ${token}`);
      return handler(new Request(`http://localhost:3000/api/xenon/${path}`, { ...init, headers }));
    }

    test("batched populate resolves nested relations in one query per target collection (zero N+1) and reuses cached records", async () => {
      const avatar1 = await uploadPng("Avatar 1", "a1.png");
      const avatar2 = await uploadPng("Avatar 2", "a2.png");
      const coverShared = avatar1; // Intentionally share a media ID between cover (depth 1) and author.avatar (depth 2).
      const cover2 = await uploadPng("Cover 2", "c2.png");

      const alice = await xenon.create({ collection: "authors", data: { name: "Alice", email: "alice@example.com", avatar: avatar1.id } });
      const bob = await xenon.create({ collection: "authors", data: { name: "Bob", email: "bob@example.com", avatar: avatar2.id } });

      // Seed 12 posts referencing Alice/Bob and covers.
      for (let i = 0; i < 12; i++) {
        await xenon.create({
          collection: "posts",
          data: {
            title: `Post ${i}`,
            author: i % 2 === 0 ? alice.id : bob.id,
            reviewer: alice.id,
            cover: i % 2 === 0 ? coverShared.id : cover2.id,
            priority: i,
            body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Big body ${i}` }] }] },
            seo: { title: `SEO ${i}`, noIndex: i % 3 === 0, ogImage: cover2.id },
            gallery: [{ caption: `Shot ${i}`, asset: cover2.id }],
            layout: [
              { blockType: "hero", heading: `Hero ${i}`, image: coverShared.id },
              { blockType: "quote", body: `Quote ${i}` },
            ],
          },
        });
      }

      const findSpy = spyOn(db, "find");
      const res = await xenon.find({
        collection: "posts",
        limit: 20,
        sort: "priority",
        select: { title: true, seo: { noIndex: true } },
        populate: {
          author: { select: { name: true }, populate: { avatar: { select: { url: true, alt: true } } } },
          reviewer: { select: { email: true } },
          cover: { select: { alt: true } },
          seo: { ogImage: { select: { alt: true } } },
          gallery: { asset: { select: { alt: true } } },
          layout: { hero: { image: { select: { alt: true } } } },
        },
      });

      expect(res.docs).toHaveLength(12);
      // Verify batched query count:
      // 1: posts list
      // 2: authors (alice + bob, shared by author & reviewer!)
      // 3: media (coverShared + cover2, shared by cover, seo.ogImage, gallery.asset, layout.hero.image!)
      // 4: media depth 2 ONLY for avatar2 (avatar1 was ALREADY cached from level 1!)
      const queriedCollections = findSpy.mock.calls.map((c) => c[0].collection);
      expect(queriedCollections.filter((c) => c === "posts")).toHaveLength(1);
      expect(queriedCollections.filter((c) => c === "authors")).toHaveLength(1);
      expect(queriedCollections.filter((c) => c === "media")).toHaveLength(2);
      // Check second media query ONLY asked for avatar2 (not avatar1 which was already cached!)
      const secondMediaCall = findSpy.mock.calls.filter((c) => c[0].collection === "media")[1]![0];
      expect((secondMediaCall.where as any).id.in).toEqual([avatar2.id]);
      findSpy.mockRestore();

      const p0 = res.docs[0]!;
      expect(Object.keys(p0).sort()).toEqual(["author", "cover", "gallery", "id", "layout", "reviewer", "seo", "title"]);
      expect("body" in p0).toBe(false);
      // Same author ID with different select specs on `author` vs `reviewer` did not clobber each other!
      expect(p0.author).toEqual({
        id: alice.id,
        name: "Alice",
        avatar: { id: avatar1.id, alt: "Avatar 1", url: avatar1.url },
      });
      expect(p0.reviewer).toEqual({ id: alice.id, email: "alice@example.com" });
      expect(p0.cover).toEqual({ id: coverShared.id, alt: "Avatar 1" });
      expect(p0.seo).toEqual({ noIndex: true, ogImage: { id: cover2.id, alt: "Cover 2" } });
      expect(p0.gallery[0]!.asset).toEqual({ id: cover2.id, alt: "Cover 2" });
      expect(p0.layout[0]).toMatchObject({ blockType: "hero", heading: "Hero 0", image: { id: coverShared.id, alt: "Avatar 1" } });
      expect(p0.layout[1]).toMatchObject({ blockType: "quote", body: "Quote 0" });
    });

    test("handles hasMany, cycles, deleted/draft targets, and draft mode populate cleanly", async () => {
      const publishedAuthor = await xenon.create({ collection: "authors", data: { name: "Pub", email: "pub@example.com" } });
      const draftAuthor = await xenon.create({ collection: "authors", data: { name: "Drafted", email: "draft@example.com" }, draft: true });

      const p1 = await xenon.create({ collection: "posts", data: { title: "First", author: publishedAuthor.id } });
      const p2 = await xenon.create({
        collection: "posts",
        data: { title: "Second", author: draftAuthor.id, related: [p1.id, "00000000-0000-4000-8000-000000000000"] },
      });
      // Make a cycle: p1 -> p2 -> p1
      await xenon.update({ collection: "posts", id: p1.id, data: { related: [p2.id] } });

      // Published read hides draftAuthor (`null`) and drops missing ID from `related`
      const pubP2 = await xenon.findById({
        collection: "posts",
        id: p2.id,
        populate: { author: true, related: { populate: { related: { select: { title: true } } } } },
      });
      expect(pubP2?.author).toBeNull();
      expect(pubP2?.related).toHaveLength(1);
      expect(pubP2?.related?.[0]?.id).toBe(p1.id);
      expect(pubP2?.related?.[0]?.related).toEqual([{ id: p2.id, title: "Second" }]);

      // Draft read resolves draftAuthor!
      const draftP2 = await xenon.findById({
        collection: "posts",
        id: p2.id,
        draft: true,
        populate: { author: { select: { name: true } } },
      });
      expect(draftP2?.author).toEqual({ id: draftAuthor.id, name: "Drafted" });

      // findBySlug supports select + populate too
      const bySlug = await xenon.findBySlug({
        collection: "posts",
        slug: p1.slug!,
        select: { title: true },
        populate: { author: { select: { name: true } } },
      });
      expect(bySlug).toEqual({ id: p1.id, title: "First", author: { id: publishedAuthor.id, name: "Pub" } });
    });

    test("nested dot-path where honors group field defaultValue and nested sort", async () => {
      const alice = await xenon.create({ collection: "authors", data: { name: "Alice", email: "a@example.com" } });
      const pDefault = await xenon.create({ collection: "posts", data: { title: "Default SEO", author: alice.id } });
      const pHidden = await xenon.create({
        collection: "posts",
        data: { title: "Hidden SEO", author: alice.id, seo: { noIndex: true, title: "Zeta" }, meta: { env: "prod", tier: 2 } },
      });
      const pShown = await xenon.create({
        collection: "posts",
        data: { title: "Shown SEO", author: alice.id, seo: { noIndex: false, title: "Alpha" }, meta: { env: "staging", tier: 1 } },
      });

      // `seo.noIndex` defaults to `false`, so querying `equals: false` must return BOTH pDefault and pShown!
      const indexable = await xenon.find({ collection: "posts", where: { "seo.noIndex": { equals: false } } });
      expect(indexable.docs.map((d) => d.id).sort()).toEqual([pDefault.id, pShown.id].sort());

      const hidden = await xenon.find({ collection: "posts", where: { "seo.noIndex": { equals: true } } });
      expect(hidden.docs.map((d) => d.id)).toEqual([pHidden.id]);

      // Nested sort on group field
      const sorted = await xenon.find({ collection: "posts", sort: "seo.title" });
      expect(sorted.docs.map((d) => d.id)).toEqual([pShown.id, pHidden.id, pDefault.id]);

      // Nested json field query via REST
      const restJson = await req(`posts?where[meta.env][equals]=prod&select=title,seo.noIndex`);
      expect(restJson.status).toBe(200);
      expect(await restJson.json()).toMatchObject({
        docs: [{ id: pHidden.id, title: "Hidden SEO", seo: { noIndex: true } }],
        totalDocs: 1,
      });
    });

    test("unique: true returns 409 CONFLICT with exact field path in Local API and REST", async () => {
      const alice = await xenon.create({ collection: "authors", data: { name: "Alice", email: "dup@example.com" } });
      await expect(
        xenon.create({ collection: "authors", data: { name: "Alice Two", email: "dup@example.com" } }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        status: 409,
        issues: [{ path: ["email"] }],
      });

      // Nested unique inside group via REST returns 409 with path ["seo", "canonicalId"]
      await xenon.create({
        collection: "posts",
        data: { title: "One", author: alice.id, sku: "SKU-1", seo: { canonicalId: "canon-1" } },
      });
      const restDup = await req(
        "posts",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Two", author: alice.id, sku: "SKU-2", seo: { canonicalId: "canon-1" } }),
        },
        "editor-key",
      );
      expect(restDup.status).toBe(409);
      const errBody = await restDup.json();
      expect(errBody.errors[0].path).toEqual(["seo", "canonicalId"]);
    });

    test("target collection access.read is enforced on populate and downgrades REST Cache-Control", async () => {
      const alice = await xenon.create({ collection: "authors", data: { name: "Alice", email: "alice@example.com" } });
      const secret = await xenon.create({ collection: "secrets", data: { label: "Top Secret", code: "007" } });
      const post = await xenon.create({
        collection: "posts",
        data: { title: "Linked", author: alice.id, secretRef: secret.id },
      });

      // Public populate (authors has no access.read) is publicly cacheable with ETag/304.
      const pubRes = await req(`posts?populate[author][select][name]=true&select[title]=true`);
      expect(pubRes.status).toBe(200);
      expect(pubRes.headers.get("cache-control")).toContain("public");
      const etag = pubRes.headers.get("etag");
      expect(etag).toBeTruthy();
      expect(await pubRes.json()).toMatchObject({
        docs: [{ id: post.id, title: "Linked", author: { id: alice.id, name: "Alice" } }],
      });
      const res304 = await req(`posts?populate[author][select][name]=true&select[title]=true`, {
        headers: { "if-none-match": etag! },
      });
      expect(res304.status).toBe(304);

      // Single-doc GET also supports populate + select
      const singleRes = await req(`posts/${post.id}?select=title&populate[author][select][name]=true`);
      expect(singleRes.status).toBe(200);
      expect(await singleRes.json()).toEqual({ id: post.id, title: "Linked", author: { id: alice.id, name: "Alice" } });

      // Anonymous request populating restricted `secrets` returns 401 with private, no-store (even on empty result!)
      const anonSecret = await req(`posts?where[title][equals]=does-not-exist&populate[secretRef]=true`);
      expect(anonSecret.status).toBe(401);
      expect(anonSecret.headers.get("cache-control")).toBe("private, no-store");

      // Editor (non-admin) populating restricted `secrets` returns 403
      const editorSecret = await req(`posts/${post.id}?populate[secretRef]=true`, {}, "editor-key");
      expect(editorSecret.status).toBe(403);
      expect(editorSecret.headers.get("cache-control")).toBe("private, no-store");

      // Admin succeeds, AND response MUST be private, no-store (never publicly cached!)
      const adminSecret = await req(`posts/${post.id}?select=title&populate[secretRef][select][label]=true`, {}, "admin-key");
      expect(adminSecret.status).toBe(200);
      expect(adminSecret.headers.get("cache-control")).toBe("private, no-store");
      expect(adminSecret.headers.get("vary")).toContain("Authorization");
      expect(await adminSecret.json()).toEqual({
        id: post.id,
        title: "Linked",
        secretRef: { id: secret.id, label: "Top Secret" },
      });
    });

    test("Local API rejects invalid select / populate inputs with BAD_REQUEST", async () => {
      await expect(xenon.find({ collection: "posts", select: { nope: true } as any })).rejects.toBeInstanceOf(XenonError);
      await expect(xenon.find({ collection: "posts", populate: { title: true } as any })).rejects.toBeInstanceOf(XenonError);
      await expect(
        xenon.find({ collection: "posts", populate: { author: { badOption: true } } as any }),
      ).rejects.toBeInstanceOf(XenonError);
    });
  });
}

runSuite("memory", () => memoryAdapter());
runSuite("pglite", () => pgliteAdapter());
