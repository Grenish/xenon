import { describe, expect, test } from "bun:test";
import { memoryAdapter } from "../../src/adapters/memory";
import { XenonConfigError } from "../../src/core/config";
import { XenonError, type XenonErrorCode } from "../../src/core/errors";
import { defineCollection, defineConfig, group, relation, text } from "../../src/index";
import type { AnyCollection } from "../../src/index";
import { createXenon } from "../../src/server/xenon";

const SECRET = "trash-test-secret-abcdefghijklmnopqrstuvwxyz-0123456789";
const editor = { id: "u-1", email: "ed@example.com", name: "Ed", role: "editor" as const };

function setup(hooks: { log?: string[] } = {}) {
  const log = hooks.log ?? [];
  const posts = defineCollection({
    slug: "posts",
    slugFrom: "title",
    trash: true,
    versions: true,
    fields: {
      title: text({ required: true }),
      sku: text({ unique: true }),
      seo: group({ fields: { canonical: text({ unique: true }), description: text() } }),
      author: relation({ relationTo: "authors" }),
    },
    hooks: {
      beforeDelete: ({ permanent }) => void log.push(`beforeDelete:${permanent}`),
      afterDelete: ({ permanent }) => void log.push(`afterDelete:${permanent}`),
      afterChange: ({ operation }) => void log.push(`afterChange:${operation}`),
    },
  });
  const authors = defineCollection({ slug: "authors", trash: true, fields: { name: text({ required: true }) } });
  const notes = defineCollection({ slug: "notes", drafts: false, fields: { body: text({ required: true }) } });
  const config = defineConfig({ collections: [posts, authors, notes], db: memoryAdapter(), auth: { secret: SECRET, baseURL: "http://localhost:3000" } });
  const events: string[] = [];
  const xenon = createXenon(config, { onChange: (e) => void events.push(`${e.op}:${e.collection}`) });
  return { xenon, log, events, db: config.db! };
}

const expectError = async (promise: Promise<unknown>, code: XenonErrorCode) => {
  const err = await promise.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(XenonError);
  expect((err as XenonError).code).toBe(code);
};

describe("trash (#18)", () => {
  test("delete moves to the trash: hidden from reads and writes, listed with `trash: true`, slug kept", async () => {
    const { xenon, log, events } = setup();
    const doc = await xenon.create({ collection: "posts", data: { title: "Hello" } });
    log.length = 0;
    const removed = await xenon.delete({ collection: "posts", id: doc.id });
    expect(removed.title).toBe("Hello");
    expect(log).toEqual(["beforeDelete:false", "afterDelete:false"]);
    expect(events.at(-1)).toBe("delete:posts");

    expect(await xenon.findById({ collection: "posts", id: doc.id })).toBeNull();
    expect(await xenon.findById({ collection: "posts", id: doc.id, draft: true })).toBeNull();
    expect((await xenon.find({ collection: "posts", draft: true })).totalDocs).toBe(0);
    expect((await xenon.findById({ collection: "posts", id: doc.id, trash: true }))?.title).toBe("Hello");
    const bin = await xenon.find({ collection: "posts", trash: true });
    expect(bin.docs.map((d) => d.id)).toEqual([doc.id]);

    await expectError(xenon.update({ collection: "posts", id: doc.id, data: { title: "x" } }), "NOT_FOUND");
    await expectError(xenon.delete({ collection: "posts", id: doc.id }), "NOT_FOUND");
    // The trashed document still holds its slug.
    expect((await xenon.create({ collection: "posts", data: { title: "Hello" } })).slug).toBe("hello-2");
  });

  test("restore brings it back (afterChange `restore`, onChange update); purge deletes for good with its versions", async () => {
    const { xenon, log, events, db } = setup();
    const doc = await xenon.create({ collection: "posts", data: { title: "Back" } });
    await xenon.delete({ collection: "posts", id: doc.id });
    log.length = 0;
    const restored = await xenon.restore({ collection: "posts", id: doc.id });
    expect(restored).toMatchObject({ id: doc.id, title: "Back", status: "published", slug: "back" });
    expect(log).toEqual(["afterChange:restore"]);
    expect(events.at(-1)).toBe("update:posts");
    expect((await xenon.findById({ collection: "posts", id: doc.id }))?.title).toBe("Back");
    await expectError(xenon.restore({ collection: "posts", id: doc.id }), "NOT_FOUND");

    await xenon.delete({ collection: "posts", id: doc.id });
    log.length = 0;
    const count = events.length;
    await xenon.purge({ collection: "posts", id: doc.id });
    // Already off the site: no delete hooks or onChange again.
    expect(log).toEqual([]);
    expect(events.length).toBe(count);
    expect(await db.findById("posts", doc.id)).toBeNull();
    expect((await db.findVersions!({ collection: "posts", documentId: doc.id })).totalDocs).toBe(0);
    await expectError(xenon.purge({ collection: "posts", id: doc.id }), "NOT_FOUND");

    // Purging a live document runs the delete hooks as a permanent delete.
    const live = await xenon.create({ collection: "posts", data: { title: "Gone" } });
    log.length = 0;
    await xenon.purge({ collection: "posts", id: live.id });
    expect(log).toEqual(["beforeDelete:true", "afterDelete:true"]);
  });

  test("relations to a trashed document populate as null; trashing clears schedules; access is enforced", async () => {
    const { xenon } = setup();
    const author = await xenon.create({ collection: "authors", data: { name: "Ada" } });
    const post = await xenon.create({ collection: "posts", data: { title: "P", author: author.id } });
    await xenon.delete({ collection: "authors", id: author.id });
    expect((await xenon.findById({ collection: "posts", id: post.id, populate: { author: true } }))?.author).toBeNull();

    await xenon.update({ collection: "posts", id: post.id, data: { title: "Next" }, draft: true });
    await xenon.schedule({ collection: "posts", id: post.id, publishAt: new Date(Date.now() + 60_000) });
    await xenon.delete({ collection: "posts", id: post.id });
    await xenon.restore({ collection: "posts", id: post.id });
    expect(await xenon.getSchedule({ collection: "posts", id: post.id })).toEqual({ publishAt: null, unpublishAt: null });

    await expectError(xenon.find({ collection: "posts", trash: true, overrideAccess: false }), "UNAUTHORIZED");
    await expectError(xenon.restore({ collection: "posts", id: post.id, overrideAccess: false }), "UNAUTHORIZED");
    await expectError(xenon.purge({ collection: "posts", id: post.id, overrideAccess: false }), "UNAUTHORIZED");
  });

  test("collections without trash delete permanently", async () => {
    const { xenon, db } = setup();
    const note = await xenon.create({ collection: "notes", data: { body: "x" } });
    await xenon.delete({ collection: "notes", id: note.id });
    expect(await db.findById("notes", note.id)).toBeNull();
    expect(() => defineConfig({ collections: [defineCollection({ slug: "x", trash: "yes", fields: { a: text() } } as never)] as AnyCollection[] })).toThrow(XenonConfigError);
  });
});

describe("duplicate (#18)", () => {
  test("copies the working copy into a new draft with a fresh slug, without unique values, with overrides", async () => {
    const { xenon } = setup();
    const doc = await xenon.create({ collection: "posts", data: { title: "Launch", sku: "SKU-1", seo: { canonical: "c-1", description: "d" } } });
    await xenon.update({ collection: "posts", id: doc.id, data: { title: "Launch v2" }, draft: true });

    const copy = await xenon.duplicate({ collection: "posts", id: doc.id, user: editor });
    expect(copy.id).not.toBe(doc.id);
    expect(copy).toMatchObject({ title: "Launch v2", status: "draft", slug: "launch-v2", seo: { description: "d" } });
    expect(copy.sku).toBeUndefined();
    expect(copy.seo.canonical).toBeUndefined();
    expect((await xenon.findVersions({ collection: "posts", id: copy.id })).docs[0]?.author?.id).toBe("u-1");

    const named = await xenon.duplicate({ collection: "posts", id: doc.id, data: { title: "Launch (copy)" } });
    expect(named).toMatchObject({ title: "Launch (copy)", slug: "launch-copy" });
    // The source is untouched.
    expect((await xenon.findById({ collection: "posts", id: doc.id, draft: true }))?.title).toBe("Launch v2");
  });

  test("drafts-off collections duplicate as published; access, trash and missing documents are checked", async () => {
    const { xenon } = setup();
    const note = await xenon.create({ collection: "notes", data: { body: "x" } });
    expect((await xenon.duplicate({ collection: "notes", id: note.id })).status).toBe("published");
    await expectError(xenon.duplicate({ collection: "notes", id: note.id, overrideAccess: false }), "UNAUTHORIZED");
    await expectError(xenon.duplicate({ collection: "notes", id: "missing" }), "NOT_FOUND");
    const post = await xenon.create({ collection: "posts", data: { title: "T" } });
    await xenon.delete({ collection: "posts", id: post.id });
    await expectError(xenon.duplicate({ collection: "posts", id: post.id }), "NOT_FOUND");
  });
});
