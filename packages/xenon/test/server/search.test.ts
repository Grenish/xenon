import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { memoryAdapter } from "../../src/adapters/memory";
import { pgliteAdapter } from "../../src/adapters/postgres/pglite";
import type { DatabaseAdapter } from "../../src/adapters/types";
import { dispatchAdminAction } from "../../src/http/admin-action";
import { loadAdminData } from "../../src/http/admin-loader";
import { createHandler } from "../../src/http/handler";
import {
  array,
  blocks,
  boolean,
  defineBlock,
  defineCollection,
  defineConfig,
  email,
  group,
  json,
  number,
  relation,
  richText,
  select,
  text,
  textarea,
  url,
} from "../../src/index";
import { searchTextFor } from "../../src/server/search";
import { createXenon } from "../../src/server/xenon";
import type { StorageAdapter } from "../../src/adapters/types";

function richDoc(...paragraphs: string[]) {
  return {
    type: "doc" as const,
    content: paragraphs.map((line) => ({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    })),
  };
}

function memoryStorage(): StorageAdapter {
  const files = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    name: "memory",
    async upload(file) {
      files.set(file.key, { body: file.body, contentType: file.contentType });
      return { key: file.key, url: `/api/xenon/_files/${file.key}` };
    },
    async read(key) {
      const hit = files.get(key);
      return hit ? { body: hit.body, contentType: hit.contentType, size: hit.body.byteLength } : null;
    },
    async delete(key) {
      files.delete(key);
    },
    getUrl(key) {
      return `/api/xenon/_files/${key}`;
    },
  };
}

const heroBlock = defineBlock({
  slug: "hero",
  fields: {
    headline: text({ required: true }),
    cta: url(),
  },
});

const authors = defineCollection({
  slug: "authors",
  drafts: false,
  fields: {
    name: text({ required: true }),
    contact: email(),
  },
});

const posts = defineCollection({
  slug: "posts",
  slugFrom: "title",
  fields: {
    title: text({ required: true }),
    summary: textarea(),
    category: select({ options: ["engineering", "design", "changelog"] }),
    tags: select({ options: ["postgres", "search", "preview"], hasMany: true }),
    body: richText(),
    author: relation({ relationTo: "authors" }),
    views: number(),
    featured: boolean(),
    meta: json(),
    seo: group({
      fields: {
        description: textarea(),
      },
    }),
    highlights: array({
      fields: {
        label: text({ required: true }),
      },
    }),
    layout: blocks({
      blocks: [heroBlock],
    }),
  },
});

const media = defineCollection({
  slug: "media",
  upload: true,
  fields: {
    alt: text(),
  },
});

describe("searchTextFor helper", () => {
  test("extracts text, richText, select, nested group/array/blocks, slug, and upload filename while skipping non-text fields", () => {
    const extracted = searchTextFor(
      posts,
      {
        title: "Full-Text Indexing",
        summary: "Fast GIN lookup",
        category: "engineering",
        tags: ["postgres", "search"],
        body: richDoc("Powered by tsvector columns", "Ranked with ts_rank"),
        author: "secret-author-uuid-1234",
        views: 98765,
        featured: true,
        meta: { opaque: "do-not-index-raw-json" },
        seo: { description: "Search engine snippet" },
        highlights: [{ id: "row-1", label: "Zero latency" }],
        layout: [{ id: "blk-1", blockType: "hero", headline: "Ship Faster", cta: "https://xenon.dev/docs" }],
      },
      "full-text-indexing",
    );

    expect(extracted).toContain("Full-Text Indexing");
    expect(extracted).toContain("Fast GIN lookup");
    expect(extracted).toContain("engineering");
    expect(extracted).toContain("postgres");
    expect(extracted).toContain("Powered by tsvector columns");
    expect(extracted).toContain("Search engine snippet");
    expect(extracted).toContain("Zero latency");
    expect(extracted).toContain("Ship Faster");
    expect(extracted).toContain("https://xenon.dev/docs");
    expect(extracted).toContain("full-text-indexing");
    expect(extracted).not.toContain("secret-author-uuid-1234");
    expect(extracted).not.toContain("98765");
    expect(extracted).not.toContain("do-not-index-raw-json");

    const uploadText = searchTextFor(media, { alt: "Mountain sunset", filename: "alps-hero.webp" }, null);
    expect(uploadText).toContain("Mountain sunset");
    expect(uploadText).toContain("alps-hero.webp");
  });
});

const adapters: [string, () => DatabaseAdapter][] = [
  ["memory", () => memoryAdapter()],
  ["pglite", () => pgliteAdapter()],
];

describe.each(adapters)("Full-text search (#17) on %s adapter", (_name, makeDb) => {
  function setup() {
    const db = makeDb();
    const config = defineConfig({
      collections: [authors, posts, media],
      db,
      storage: memoryStorage(),
      auth: {
        secret: "search-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
        baseURL: "http://localhost:3000",
        apiKeys: [{ key: "test-admin-key", role: "admin", name: "test" }],
      },
    });
    const xenon = createXenon(config);
    const handler = createHandler(config, { xenon });
    return { db, config, xenon, handler };
  }

  test("Local API find({ search }) searches richText, nested fields, uploads, combines with where/populate/select, and isolates drafts", async () => {
    const { xenon, db } = setup();
    try {
      const author = await xenon.create({
        collection: "authors",
        data: { name: "Ada Lovelace", contact: "ada@example.com" },
        overrideAccess: true,
      });

      const guide = await xenon.create({
        collection: "posts",
        data: {
          title: "Postgres Search Deep Dive",
          summary: "Postgres full-text search architecture",
          category: "engineering",
          tags: ["postgres", "search"],
          body: richDoc("PostgreSQL tsvector indexes accelerate lexeme queries across rich text documents."),
          author: author.id,
          seo: { description: "Canonical tsvector guide" },
          highlights: [{ label: "Sub-millisecond GIN lookups" }],
          layout: [{ blockType: "hero", headline: "Search Everything" }],
        },
        draft: false,
        overrideAccess: true,
      });

      const release = await xenon.create({
        collection: "posts",
        data: {
          title: "Release Notes",
          summary: "Postgres performance update",
          category: "changelog",
          body: richDoc("Minor improvements and bugfixes."),
          author: author.id,
        },
        draft: false,
        overrideAccess: true,
      });

      // Upload collection search matches filename + alt.
      const asset = await xenon.create({
        collection: "media",
        data: { alt: "Architecture diagram" },
        file: { data: new Uint8Array([1, 2, 3]), name: "tsvector-diagram.bin", type: "application/octet-stream" },
        overrideAccess: true,
      });
      expect((await xenon.find({ collection: "media", search: "tsvector-diagram" })).docs.map((d) => d.id)).toEqual([asset.id]);
      expect((await xenon.find({ collection: "media", search: "diagram" })).docs.map((d) => d.id)).toEqual([asset.id]);

      // Search matches richText body, nested group, array, and blocks.
      expect((await xenon.find({ collection: "posts", search: "lexeme" })).docs.map((d) => d.id)).toEqual([guide.id]);
      expect((await xenon.find({ collection: "posts", search: "canonical" })).docs.map((d) => d.id)).toEqual([guide.id]);
      expect((await xenon.find({ collection: "posts", search: "millisecond" })).docs.map((d) => d.id)).toEqual([guide.id]);
      expect((await xenon.find({ collection: "posts", search: '"search everything"' })).docs.map((d) => d.id)).toEqual([guide.id]);

      // Relevance ranking puts guide (multiple "postgres" hits) before release (single hit).
      const ranked = await xenon.find({ collection: "posts", search: "postgres" });
      expect(ranked.docs.map((d) => d.id)).toEqual([guide.id, release.id]);

      // Combined with where, populate, and select.
      const combined = await xenon.find({
        collection: "posts",
        search: "postgres",
        where: { category: { equals: "changelog" } },
        populate: { author: true },
        select: { title: true, author: true },
      });
      expect(combined.totalDocs).toBe(1);
      expect(combined.docs[0]?.id).toBe(release.id);
      expect(combined.docs[0]?.author?.name).toBe("Ada Lovelace");

      // Draft vs published isolation: editing a published doc as a draft must NOT leak draft text into published search.
      await xenon.update({
        collection: "posts",
        id: release.id,
        draft: true,
        data: { title: "Embargoed Quantum Announcement", body: richDoc("Confidential quantum milestone") },
        overrideAccess: true,
      });
      expect((await xenon.find({ collection: "posts", search: "quantum" })).totalDocs).toBe(0);
      expect((await xenon.find({ collection: "posts", search: "bugfixes" })).docs.map((d) => d.id)).toEqual([release.id]);
      expect((await xenon.find({ collection: "posts", draft: true, search: "quantum" })).docs.map((d) => d.id)).toEqual([release.id]);
      expect((await xenon.find({ collection: "posts", draft: true, search: "bugfixes" })).totalDocs).toBe(0);

      // Unpublishing removes from published search while retaining draft search.
      await xenon.unpublish({ collection: "posts", id: guide.id, overrideAccess: true });
      expect((await xenon.find({ collection: "posts", search: "lexeme" })).totalDocs).toBe(0);
      expect((await xenon.find({ collection: "posts", draft: true, search: "lexeme" })).docs.map((d) => d.id)).toEqual([guide.id]);

      // Publishing the pending draft updates the live vector and clears the draft vector.
      await xenon.update({
        collection: "posts",
        id: release.id,
        draft: false,
        data: { title: "Embargoed Quantum Announcement", body: richDoc("Confidential quantum milestone") },
        overrideAccess: true,
      });
      expect((await xenon.find({ collection: "posts", search: "quantum" })).docs.map((d) => d.id)).toEqual([release.id]);
      expect((await xenon.find({ collection: "posts", search: "bugfixes" })).totalDocs).toBe(0);
    } finally {
      await db.close?.();
    }
  });

  test("REST GET ?search=..., admin list ?q=..., and doc.search use full-text search", async () => {
    const { db, config, xenon, handler } = setup();
    try {
      const post = await xenon.create({
        collection: "posts",
        data: {
          title: "Quiet Title",
          body: richDoc("Hidden zeppelin paragraph inside rich text body"),
        },
        draft: false,
        overrideAccess: true,
      });

      // REST ?search= finds by richText body.
      const res = await handler(new Request("http://localhost:3000/api/xenon/posts?search=zeppelin"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { docs: { id: string }[]; totalDocs: number };
      expect(body.totalDocs).toBe(1);
      expect(body.docs[0]?.id).toBe(post.id);

      // REST rejects excessively long search query (>500 chars).
      const tooLong = await handler(new Request(`http://localhost:3000/api/xenon/posts?search=${"a".repeat(501)}`));
      expect(tooLong.status).toBe(400);

      // Admin collection list (?q=...) and doc.search (⌘K) find by richText body too!
      const setupRes = await handler(
        new Request("http://localhost:3000/api/xenon/_admin/action", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000" },
          body: JSON.stringify({
            type: "auth.setup",
            name: "Admin",
            email: "admin@example.com",
            password: "password123",
          }),
        }),
      );
      expect(setupRes.status).toBe(200);
      const cookie = setupRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
      const sessionHeaders = new Headers({ cookie });

      const listData = await loadAdminData({
        config,
        xenon,
        segments: ["collections", "posts"],
        query: new URLSearchParams({ q: "zeppelin" }),
        headers: sessionHeaders,
      });
      expect(listData.kind).toBe("collection-list");
      if (listData.kind === "collection-list") {
        expect(listData.totalDocs).toBe(1);
        expect(listData.rows[0]?.id).toBe(post.id);
      }

      const cmdSearch = await dispatchAdminAction(
        config,
        { type: "doc.search", collection: "posts", query: "zeppelin" },
        sessionHeaders,
        { xenon },
      );
      expect(cmdSearch.ok).toBe(true);
      if (cmdSearch.ok) {
        const resData = cmdSearch.data as { docs: { id: string }[]; totalDocs: number };
        expect(resData.totalDocs).toBe(1);
        expect(resData.docs[0]?.id).toBe(post.id);
      }
    } finally {
      await db.close?.();
    }
  });
});

describe("PostgreSQL GIN search indexes", () => {
  test("creates GIN indexes on search_vector and draft_search_vector in PGlite", async () => {
    const db = pgliteAdapter();
    try {
      await db.init();
      const result = await db.db.execute(
        sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'xenon_documents' AND indexname LIKE 'xenon_documents_%search_vector_gin_idx' ORDER BY indexname`,
      );
      const rows = (result.rows ?? result) as { indexname: string; indexdef: string }[];
      expect(rows.map((r) => r.indexname)).toEqual([
        "xenon_documents_draft_search_vector_gin_idx",
        "xenon_documents_search_vector_gin_idx",
      ]);
      for (const row of rows) {
        expect(row.indexdef.toLowerCase()).toContain("using gin");
      }
    } finally {
      await db.close?.();
    }
  });
});
