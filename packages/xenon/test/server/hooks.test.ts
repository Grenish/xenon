import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryAdapter } from "../../src/adapters/memory";
import { XenonConfigError } from "../../src/core/config";
import { XenonError } from "../../src/core/errors";
import {
  array,
  blocks,
  defineBlock,
  defineCollection,
  defineConfig,
  group,
  number,
  relation,
  text,
} from "../../src/index";
import type { AnyCollection } from "../../src/index";
import { createHandler } from "../../src/http";
import { createXenon } from "../../src/server/xenon";
import { LocalStorageAdapter } from "../../src/storage/local";

const SECRET = "hooks-test-secret-abcdefghijklmnopqrstuvwxyz-0123456789";

function configWith<const Cs extends readonly AnyCollection[]>(collections: Cs, extra: { storage?: LocalStorageAdapter } = {}) {
  return defineConfig({
    collections,
    db: memoryAdapter(),
    ...extra,
    auth: { secret: SECRET, baseURL: "http://localhost:3000", apiKeys: [{ key: "editor-key", role: "editor" }] },
  });
}

describe("collection hooks: order and data flow", () => {
  test("create runs every stage in order; fields before collection; returned data flows on", async () => {
    const log: string[] = [];
    const posts = defineCollection({
      slug: "posts",
      fields: {
        title: text({
          required: true,
          hooks: {
            beforeValidate: ({ value }) => {
              log.push("field.beforeValidate");
              return typeof value === "string" ? value.trim() : value;
            },
            beforeChange: () => void log.push("field.beforeChange"),
            afterChange: () => void log.push("field.afterChange"),
            afterRead: () => void log.push("field.afterRead"),
          },
        }),
        words: number(),
        summary: text(),
      },
      hooks: {
        beforeValidate: [
          ({ data, operation, originalDoc }) => {
            log.push(`beforeValidate:${operation}:${originalDoc === null}`);
            // Derive a required value before validation runs.
            return { ...data, title: data.title ?? "Untitled" };
          },
        ],
        beforeChange: ({ data }) => {
          log.push("beforeChange");
          return { ...data, words: String(data.title ?? "").split(/\s+/).length };
        },
        afterChange: ({ doc, previousDoc, operation }) => {
          log.push(`afterChange:${operation}:${doc.words}:${previousDoc === null}`);
        },
        afterRead: ({ doc }) => {
          log.push("afterRead");
          return { ...doc, summary: `${doc.title} (${doc.words})` };
        },
      },
    });
    const xenon = createXenon(configWith([posts]), { onChange: () => void log.push("onChange") });

    const doc = await xenon.create({ collection: "posts", data: { title: "  hello big world  " } });
    expect(doc.title).toBe("hello big world");
    expect(doc.words).toBe(3);
    expect(doc.summary).toBe("hello big world (3)");
    expect(log).toEqual([
      "field.beforeValidate",
      "beforeValidate:create:true",
      "field.beforeChange",
      "beforeChange",
      "onChange",
      "field.afterChange",
      "afterChange:create:3:true",
      "field.afterRead",
      "afterRead",
    ]);

    // beforeValidate can satisfy `required`.
    const untitled = await xenon.create({ collection: "posts", data: {} });
    expect(untitled.title).toBe("Untitled");
  });

  test("update passes the merged working copy, originalDoc and previousDoc", async () => {
    const seen: Record<string, unknown>[] = [];
    const posts = defineCollection({
      slug: "posts",
      fields: { title: text({ required: true }), body: text() },
      hooks: {
        beforeValidate: ({ data, originalDoc, operation }) => void seen.push({ stage: "bv", data: { ...data }, original: originalDoc?.title, operation }),
        afterChange: ({ doc, previousDoc, draft }) => void seen.push({ stage: "ac", doc: doc.title, prev: previousDoc?.title, draft }),
      },
    });
    const xenon = createXenon(configWith([posts]));
    const created = await xenon.create({ collection: "posts", data: { title: "One", body: "Body" } });
    seen.length = 0;
    await xenon.update({ collection: "posts", id: created.id, data: { title: "Two" }, draft: true });
    expect(seen).toEqual([
      { stage: "bv", data: { title: "Two", body: "Body" }, original: "One", operation: "update" },
      { stage: "ac", doc: "Two", prev: "One", draft: true },
    ]);
  });

  test("hook input is a copy: the caller's object is never mutated", async () => {
    const posts = defineCollection({
      slug: "posts",
      fields: {
        meta: group({ fields: { tag: text({ hooks: { beforeValidate: ({ value }) => String(value).toUpperCase() } }) } }),
        note: text(),
      },
      hooks: { beforeValidate: ({ data }) => { data.note = "set by hook"; } },
    });
    const xenon = createXenon(configWith([posts]));
    const input = { meta: { tag: "news" } };
    const doc = await xenon.create({ collection: "posts", data: input });
    expect(doc.meta.tag).toBe("NEWS");
    expect(doc.note).toBe("set by hook");
    expect(input).toEqual({ meta: { tag: "news" } });
  });

  test("beforeChange output is trimmed to the schema", async () => {
    const posts = defineCollection({
      slug: "posts",
      fields: { title: text() },
      hooks: { beforeChange: ({ data }) => ({ ...data, notAField: "x" }) as never },
    });
    const config = configWith([posts]);
    const xenon = createXenon(config);
    const doc = await xenon.create({ collection: "posts", data: { title: "A" } });
    const record = await config.db!.findById("posts", doc.id);
    expect(record?.data).toEqual({ title: "A" });
  });

  test("a hook returning a non-object fails loudly", async () => {
    const posts = defineCollection({
      slug: "posts",
      fields: { title: text() },
      hooks: { beforeChange: () => "nope" as never },
    });
    const xenon = createXenon(configWith([posts]));
    await expect(xenon.create({ collection: "posts", data: { title: "A" } })).rejects.toThrow(/must return an object/);
  });

  test("a thrown XenonError rejects the write with its status (REST 400)", async () => {
    const posts = defineCollection({
      slug: "posts",
      fields: { title: text() },
      hooks: {
        beforeValidate: ({ data }) => {
          if (data.title === "spam") {
            throw new XenonError("VALIDATION", "No spam.", [{ path: ["title"], message: "No spam." }]);
          }
        },
      },
    });
    const config = configWith([posts]);
    const xenon = createXenon(config);
    const handler = createHandler(config, { xenon });
    const res = await handler(
      new Request("http://localhost:3000/api/xenon/posts", {
        method: "POST",
        headers: { authorization: "Bearer editor-key", "content-type": "application/json" },
        body: JSON.stringify({ title: "spam" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errors: [{ message: "No spam.", path: ["title"] }] });
    expect((await xenon.find({ collection: "posts" })).totalDocs).toBe(0);
  });

  test("afterChange errors reach the caller, but the write (and onChange) already happened", async () => {
    const changes: string[] = [];
    const posts = defineCollection({
      slug: "posts",
      fields: { title: text() },
      hooks: { afterChange: () => { throw new Error("webhook down"); } },
    });
    const xenon = createXenon(configWith([posts]), { onChange: (e) => void changes.push(e.op) });
    await expect(xenon.create({ collection: "posts", data: { title: "A" } })).rejects.toThrow("webhook down");
    expect((await xenon.find({ collection: "posts" })).totalDocs).toBe(1);
    expect(changes).toEqual(["create"]);
  });
});

describe("read hooks", () => {
  const users = defineCollection({
    slug: "people",
    fields: {
      name: text({ required: true }),
      email: text({ hooks: { afterRead: ({ user }) => (user ? undefined : null) } }),
    },
    hooks: { afterRead: ({ doc }) => ({ ...doc, name: doc.name.toUpperCase() }) },
  });
  const posts = defineCollection({
    slug: "posts",
    slugFrom: "title",
    fields: { title: text({ required: true }), author: relation({ relationTo: "people" }), authors: relation({ relationTo: "people", hasMany: true }) },
    hooks: { afterRead: ({ doc }) => ({ ...doc, title: `[${doc.title}]` }) },
  });

  test("afterRead runs on find, findById, findBySlug, and on populated docs before select", async () => {
    const xenon = createXenon(configWith([users, posts]));
    const ada = await xenon.create({ collection: "people", data: { name: "Ada", email: "ada@example.com" } });
    expect(ada.name).toBe("ADA");
    expect(ada.email).toBeNull(); // field afterRead masks it for anonymous callers

    const post = await xenon.create({ collection: "posts", data: { title: "Hello", author: ada.id, authors: [ada.id] } });
    expect(post.title).toBe("[Hello]");

    const list = await xenon.find({ collection: "posts", populate: { author: true, authors: true } });
    const first = list.docs[0]!;
    expect(first.title).toBe("[Hello]");
    expect(first.author).toMatchObject({ id: ada.id, name: "ADA", email: null });
    expect(first.authors![0]).toMatchObject({ name: "ADA" });

    const user = { id: "u1", email: "e@x.dev", role: "editor" as const };
    const byId = await xenon.findById({ collection: "posts", id: post.id, populate: { author: true }, user });
    expect(byId?.author).toMatchObject({ name: "ADA", email: "ada@example.com" });

    const bySlug = await xenon.findBySlug({ collection: "posts", slug: "hello", select: { title: true } });
    expect(bySlug).toEqual({ id: post.id, title: "[Hello]" });

    // select applies after afterRead inside populated docs too.
    const projected = await xenon.find({ collection: "posts", populate: { author: { select: { name: true } } } });
    expect(projected.docs[0]!.author).toEqual({ id: ada.id, name: "ADA" });
  });

  test("REST reads apply afterRead", async () => {
    const config = configWith([users, posts]);
    const xenon = createXenon(config);
    const ada = await xenon.create({ collection: "people", data: { name: "Ada", email: "ada@example.com" } });
    await xenon.create({ collection: "posts", data: { title: "Hello", author: ada.id } });
    const handler = createHandler(config, { xenon });
    const res = await handler(new Request("http://localhost:3000/api/xenon/posts?populate[author]=true"));
    const body = (await res.json()) as { docs: { title: string; author: { name: string; email: unknown } }[] };
    expect(body.docs[0]!.title).toBe("[Hello]");
    expect(body.docs[0]!.author).toMatchObject({ name: "ADA", email: null });
  });
});

describe("field hooks in containers", () => {
  test("walk groups, array rows and blocks with paths and siblingData; containers run after children", async () => {
    const calls: { path: readonly (string | number)[]; sibling: string[] }[] = [];
    const order: string[] = [];
    const record = (args: { path: readonly (string | number)[]; siblingData: Record<string, unknown> }) =>
      void calls.push({ path: args.path, sibling: Object.keys(args.siblingData).sort() });
    const cta = defineBlock({
      slug: "cta",
      fields: { label: text({ hooks: { beforeChange: [record, ({ value }) => `${value}!`] } }) },
    });
    const pages = defineCollection({
      slug: "pages",
      fields: {
        seo: group({
          fields: { title: text({ hooks: { beforeChange: (a) => { record(a); order.push("seo.title"); } } }) },
          hooks: { beforeChange: () => void order.push("seo") },
        }),
        links: array({ fields: { url: text({ hooks: { beforeChange: record } }), label: text() } }),
        layout: blocks({ blocks: [cta] }),
      },
    });
    const xenon = createXenon(configWith([pages]));
    const doc = await xenon.create({
      collection: "pages",
      data: {
        seo: { title: "T" },
        links: [{ url: "/a", label: "A" }, { url: "/b" }],
        layout: [{ blockType: "cta", label: "Go" }],
      },
    });
    expect(order).toEqual(["seo.title", "seo"]);
    expect(calls).toEqual([
      { path: ["seo", "title"], sibling: ["title"] },
      { path: ["links", 0, "url"], sibling: ["id", "label", "url"] },
      { path: ["links", 1, "url"], sibling: ["id", "url"] },
      { path: ["layout", 0, "label"], sibling: ["blockType", "id", "label"] },
    ]);
    expect(doc.layout[0]).toMatchObject({ blockType: "cta", label: "Go!" });
  });

  test("returning undefined keeps the value; null clears it", async () => {
    const posts = defineCollection({
      slug: "posts",
      fields: {
        keep: text({ hooks: { beforeChange: () => undefined } }),
        clear: text({ hooks: { beforeChange: () => null } }),
      },
    });
    const xenon = createXenon(configWith([posts]));
    const doc = await xenon.create({ collection: "posts", data: { keep: "k", clear: "c" } });
    expect(doc.keep).toBe("k");
    expect(doc.clear).toBeNull();
  });
});

describe("unpublish and delete hooks", () => {
  test("unpublish runs afterChange with operation 'unpublish'", async () => {
    const ops: string[] = [];
    const posts = defineCollection({
      slug: "posts",
      fields: { title: text() },
      hooks: { afterChange: ({ operation, doc }) => void ops.push(`${operation}:${doc.status}`) },
    });
    const xenon = createXenon(configWith([posts]));
    const doc = await xenon.create({ collection: "posts", data: { title: "A" } });
    await xenon.unpublish({ collection: "posts", id: doc.id });
    expect(ops).toEqual(["create:published", "unpublish:draft"]);
  });

  test("beforeDelete can abort; afterDelete runs after the row is gone", async () => {
    const seenRow: { value: boolean | null } = { value: null };
    const posts = defineCollection({
      slug: "posts",
      fields: { title: text(), locked: number() },
      hooks: {
        beforeDelete: ({ doc }) => {
          if (doc.locked) throw new XenonError("FORBIDDEN", "Locked.");
        },
        afterDelete: async ({ id, xenon }) => {
          seenRow.value = (await xenon.findById({ collection: "posts", id, draft: true })) !== null;
        },
      },
    });
    const xenon = createXenon(configWith([posts]));
    const locked = await xenon.create({ collection: "posts", data: { title: "L", locked: 1 } });
    const free = await xenon.create({ collection: "posts", data: { title: "F" } });
    await expect(xenon.delete({ collection: "posts", id: locked.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await xenon.findById({ collection: "posts", id: locked.id })).not.toBeNull();
    const deleted = await xenon.delete({ collection: "posts", id: free.id });
    expect(deleted.title).toBe("F");
    expect(seenRow.value).toBe(false);
  });
});

describe("context and cycle safety", () => {
  test("context is shared across hooks and forwarded to nested calls through the hooks' xenon", async () => {
    const seen: unknown[] = [];
    const audit = defineCollection({
      slug: "audit",
      fields: { note: text() },
      hooks: { beforeChange: ({ context }) => void seen.push(context.requestId) },
    });
    const posts = defineCollection({
      slug: "posts",
      fields: { title: text() },
      hooks: {
        beforeValidate: ({ context }) => { context.touched = true; },
        afterChange: async ({ context, doc, xenon }) => {
          seen.push(context.touched);
          await xenon.create({ collection: "audit", data: { note: `created ${doc.id}` } });
        },
      },
    });
    const xenon = createXenon(configWith([posts, audit]));
    const context = { requestId: "r-1" };
    await xenon.create({ collection: "posts", data: { title: "A" }, context });
    expect(seen).toEqual([true, "r-1"]);
    expect((await xenon.find({ collection: "audit" })).totalDocs).toBe(1);
  });

  test("a hook that re-triggers itself fails fast; context breaks the cycle", async () => {
    const posts = defineCollection({
      slug: "posts",
      fields: { title: text(), count: number() },
      hooks: {
        afterChange: async ({ doc, xenon, context }) => {
          if (context.stop) return;
          await xenon.update({ collection: "posts", id: doc.id, data: { count: (doc.count ?? 0) + 1 } });
        },
      },
    });
    const xenon = createXenon(configWith([posts]));
    await expect(xenon.create({ collection: "posts", data: { title: "A" } })).rejects.toThrow(/more than 16 levels deep/);

    const guarded = defineCollection({
      slug: "guarded",
      fields: { title: text(), slugged: text() },
      hooks: {
        afterChange: async ({ doc, xenon, context, operation }) => {
          if (operation !== "create" || context.inHook) return;
          context.inHook = true;
          await xenon.update({ collection: "guarded", id: doc.id, data: { slugged: String(doc.title).toLowerCase() } });
        },
      },
    });
    const x2 = createXenon(configWith([guarded]));
    const doc = await x2.create({ collection: "guarded", data: { title: "Hi" } });
    expect((await x2.findById({ collection: "guarded", id: doc.id }))?.slugged).toBe("hi");
  });
});

describe("uploads", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "xenon-hooks-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("multipart uploads run hooks; a failing beforeChange stores no file", async () => {
    const media = defineCollection({
      slug: "media",
      upload: true,
      fields: { alt: text() },
      hooks: {
        beforeChange: ({ data }) => {
          if (data.alt === "bad") throw new XenonError("VALIDATION", "Bad alt.");
          return { ...data, alt: `${data.alt ?? ""} (checked)` };
        },
        afterRead: ({ doc }) => ({ ...doc, alt: `${doc.alt}`, filename: doc.filename.toUpperCase() }),
      },
    });
    const storage = new LocalStorageAdapter({ directory: dir });
    const xenon = createXenon(configWith([media], { storage }));
    const file = { data: new TextEncoder().encode("hello"), name: "note.txt", type: "text/plain" };
    const doc = await xenon.create({ collection: "media", data: { alt: "Hi" }, file });
    expect(doc.alt).toBe("Hi (checked)");
    expect(doc.filename).toBe(doc.filename.toUpperCase());
    expect(doc.mimeType).toBe("text/plain");

    await expect(xenon.create({ collection: "media", data: { alt: "bad" }, file })).rejects.toMatchObject({ code: "VALIDATION" });
    const { readdir } = await import("node:fs/promises");
    const countFiles = async (d: string): Promise<number> => {
      let n = 0;
      for (const entry of await readdir(d, { withFileTypes: true })) {
        n += entry.isDirectory() ? await countFiles(join(d, entry.name)) : 1;
      }
      return n;
    };
    expect(await countFiles(dir)).toBe(1);
  });
});

describe("config validation", () => {
  test("rejects unknown hook names and non-functions", () => {
    expect(() =>
      defineConfig({
        collections: [defineCollection({ slug: "a", fields: { t: text() }, hooks: { beforeSave: () => {} } as never })],
      }),
    ).toThrow(XenonConfigError);
    expect(() =>
      defineConfig({
        collections: [defineCollection({ slug: "a", fields: { t: text() }, hooks: { afterRead: ["nope"] } as never })],
      }),
    ).toThrow(/hooks.afterRead must be a function or an array of functions/);
    expect(() =>
      defineConfig({
        collections: [defineCollection({ slug: "a", fields: { t: text({ hooks: { beforeDelete: () => {} } as never }) } })],
      }),
    ).toThrow(/field "t".*unknown hook "beforeDelete"/);
  });

  test("hooks never reach the admin client config", async () => {
    const { toClientCollection } = await import("../../src/ui/shared/client-config");
    const posts = defineCollection({
      slug: "posts",
      fields: { title: text({ hooks: { afterRead: () => "x" } }) },
      hooks: { afterRead: ({ doc }) => doc },
    });
    const client = toClientCollection(posts);
    expect(JSON.stringify(client)).not.toContain("hooks");
  });
});
