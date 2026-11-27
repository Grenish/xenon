import { describe, expect, test } from "bun:test";
import { memoryAdapter } from "../../src/adapters/memory";
import type { DatabaseAdapter } from "../../src/adapters/types";
import { XenonConfigError } from "../../src/core/config";
import { XenonError, type XenonErrorCode } from "../../src/core/errors";
import { array, defineCollection, defineConfig, group, relation, text } from "../../src/index";
import type { AnyCollection } from "../../src/index";
import { createXenon } from "../../src/server/xenon";

const SECRET = "versions-test-secret-abcdefghijklmnopqrstuvwxyz-0123456789";
const editor = { id: "u-1", email: "ed@example.com", name: "Ed", role: "editor" as const };

const posts = defineCollection({
  slug: "posts",
  slugFrom: "title",
  versions: { max: 3 },
  fields: {
    title: text({ required: true }),
    summary: text(),
    seo: group({ fields: { description: text() } }),
    links: array({ fields: { url: text({ required: true }) } }),
    author: relation({ relationTo: "authors" }),
  },
});
const authors = defineCollection({
  slug: "authors",
  versions: true,
  admin: { autosave: { interval: 1500 } },
  fields: { name: text({ required: true }), secret: text() },
  hooks: { afterRead: ({ doc }) => ({ ...doc, secret: null }) },
});
const pages = defineCollection({ slug: "pages", drafts: false, fields: { title: text({ required: true }) } });

function setup(db: DatabaseAdapter = memoryAdapter(), onChange?: (e: { op: string; id: string }) => void) {
  const config = defineConfig({
    collections: [posts, authors, pages],
    db,
    auth: { secret: SECRET, baseURL: "http://localhost:3000" },
  });
  return { config, xenon: createXenon(config, onChange ? { onChange } : {}), db };
}

const expectError = async (promise: Promise<unknown>, code: XenonErrorCode) => {
  const err = await promise.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(XenonError);
  expect((err as XenonError).code).toBe(code);
  return err as XenonError;
};

describe("versions (#15)", () => {
  test("publishes and manual draft saves create versions; autosaves don't; newest first with authors", async () => {
    const { xenon } = setup();
    const doc = await xenon.create({ collection: "posts", data: { title: "One" }, user: editor });
    await xenon.update({ collection: "posts", id: doc.id, data: { summary: "draft" }, draft: true });
    await xenon.update({ collection: "posts", id: doc.id, data: { summary: "typing…" }, draft: true, autosave: true });
    // `autosave` is ignored on a publish.
    await xenon.update({ collection: "posts", id: doc.id, data: { title: "Two" }, autosave: true, user: editor });

    const { docs, totalDocs } = await xenon.findVersions({ collection: "posts", id: doc.id });
    expect(totalDocs).toBe(3);
    expect(docs.map((v) => [v.kind, v.doc.title, v.doc.summary])).toEqual([
      ["publish", "Two", "typing…"],
      ["draft", "One", "draft"],
      ["publish", "One", undefined],
    ]);
    expect(docs[0]!.author).toEqual({ id: "u-1", name: "Ed", email: "ed@example.com" });
    expect(docs[1]!.author).toBeNull();
    // A version reads like its document; `updatedAt` is when the version was saved.
    expect(docs[2]!.doc).toMatchObject({ id: doc.id, slug: "one", status: "published", createdAt: doc.createdAt });
    expect(docs[2]!.doc.updatedAt).toBe(docs[2]!.createdAt);
    expect(docs[1]!.doc.status).toBe("draft");

    const one = await xenon.findVersionById({ collection: "posts", id: docs[1]!.id });
    expect(one?.doc.summary).toBe("draft");
    expect(await xenon.findVersionById({ collection: "posts", id: "missing" })).toBeNull();
  });

  test("keeps only the newest `max` versions, and deletes versions with their document", async () => {
    const { xenon, db } = setup();
    const doc = await xenon.create({ collection: "posts", data: { title: "v1" } });
    for (const title of ["v2", "v3", "v4", "v5"]) await xenon.update({ collection: "posts", id: doc.id, data: { title } });
    const kept = await xenon.findVersions({ collection: "posts", id: doc.id, limit: 100 });
    expect(kept.docs.map((v) => v.doc.title)).toEqual(["v5", "v4", "v3"]);
    await xenon.delete({ collection: "posts", id: doc.id });
    expect((await db.findVersions!({ collection: "posts", documentId: doc.id })).totalDocs).toBe(0);
    await expectError(xenon.findVersions({ collection: "posts", id: doc.id }), "NOT_FOUND");
  });

  test("restore writes the version as a draft (fields it lacked become empty), keeps the slug, and records a restore version", async () => {
    const changes: string[] = [];
    const { xenon } = setup(memoryAdapter(), (e) => changes.push(e.op));
    const doc = await xenon.create({ collection: "posts", data: { title: "Original", seo: { description: "first" } } });
    await xenon.update({
      collection: "posts", id: doc.id,
      data: { title: "Rewritten", summary: "new summary", links: [{ url: "https://x.dev" }], seo: { description: "second" } },
    });
    const [, first] = (await xenon.findVersions({ collection: "posts", id: doc.id })).docs;

    const restored = await xenon.restoreVersion({ collection: "posts", id: first!.id, user: editor });
    expect(restored).toMatchObject({ title: "Original", summary: null, links: [], seo: { description: "first" }, status: "published", slug: "original" });
    // Live content is untouched until the restored draft is published.
    expect((await xenon.findById({ collection: "posts", id: doc.id }))?.title).toBe("Rewritten");
    const latest = (await xenon.findVersions({ collection: "posts", id: doc.id })).docs[0]!;
    expect(latest.kind).toBe("restore");
    expect(latest.author?.id).toBe("u-1");
    expect(changes.at(-1)).toBe("update");

    // `draft: false` publishes the version.
    const published = await xenon.restoreVersion({ collection: "posts", id: first!.id, draft: false });
    expect((await xenon.findById({ collection: "posts", id: doc.id }))?.title).toBe("Original");
    expect(published.summary).toBeNull();
  });

  test("restore honours expectedUpdatedAt, access control and missing versions", async () => {
    const { xenon } = setup();
    const doc = await xenon.create({ collection: "posts", data: { title: "A" } });
    const [version] = (await xenon.findVersions({ collection: "posts", id: doc.id })).docs;
    await xenon.update({ collection: "posts", id: doc.id, data: { title: "B" } });
    await expectError(xenon.restoreVersion({ collection: "posts", id: version!.id, expectedUpdatedAt: doc.updatedAt }), "CONFLICT");
    await expectError(xenon.restoreVersion({ collection: "posts", id: "nope" }), "NOT_FOUND");
    await expectError(xenon.restoreVersion({ collection: "posts", id: version!.id, overrideAccess: false }), "UNAUTHORIZED");
    await expectError(xenon.findVersions({ collection: "posts", id: doc.id, overrideAccess: false }), "UNAUTHORIZED");
    expect((await xenon.findVersions({ collection: "posts", id: doc.id, overrideAccess: false, user: editor })).totalDocs).toBe(2);
  });

  test("afterRead hooks run on version documents; collections without versions refuse version calls", async () => {
    const { xenon } = setup();
    const author = await xenon.create({ collection: "authors", data: { name: "Ada", secret: "s3cret" } });
    const [v] = (await xenon.findVersions({ collection: "authors", id: author.id })).docs;
    expect(v!.doc.secret).toBeNull();
    const page = await xenon.create({ collection: "pages", data: { title: "P" } });
    await expectError(xenon.findVersions({ collection: "pages", id: page.id }), "BAD_REQUEST");
  });

  test("config: versions reject uploads and bad max; autosave needs drafts and a sane interval; adapters must support versions", async () => {
    const make = (c: Record<string, unknown>) => () =>
      defineConfig({ collections: [defineCollection({ slug: "x", fields: { a: text() }, ...c } as never)] as AnyCollection[] });
    expect(make({ versions: { max: 0 } })).toThrow(XenonConfigError);
    expect(make({ versions: { keep: 3 } })).toThrow(XenonConfigError);
    expect(make({ versions: true, upload: true })).toThrow(/upload collections/);
    expect(make({ admin: { autosave: true }, drafts: false })).toThrow(/needs drafts/);
    expect(make({ admin: { autosave: { interval: 100 } } })).toThrow(/at least 500/);
    expect(make({ versions: { max: 5 }, admin: { autosave: { interval: 800 } } })).not.toThrow();

    const bare = memoryAdapter();
    delete bare.createVersion;
    const { xenon } = setup(bare);
    await expect(xenon.init()).rejects.toThrow(/does not implement createVersion/);
  });
});

describe("scheduled publishing (#16)", () => {
  const at = (minutes: number) => new Date(Date.now() + minutes * 60_000);

  test("schedule needs pending changes, validates order and instants, and round-trips", async () => {
    const { xenon } = setup();
    const doc = await xenon.create({ collection: "posts", data: { title: "Live" } });
    const err = await expectError(xenon.schedule({ collection: "posts", id: doc.id, publishAt: at(10) }), "VALIDATION");
    expect(err.issues?.[0]?.path).toEqual(["publishAt"]);
    // An unpublish alone is fine on a live document.
    const off = at(60);
    expect(await xenon.schedule({ collection: "posts", id: doc.id, unpublishAt: off })).toEqual({ publishAt: null, unpublishAt: off.toISOString() });

    await xenon.update({ collection: "posts", id: doc.id, data: { title: "Next" }, draft: true });
    const on = at(10);
    expect(await xenon.schedule({ collection: "posts", id: doc.id, publishAt: on.toISOString() })).toEqual({ publishAt: on.toISOString(), unpublishAt: off.toISOString() });
    const order = await expectError(xenon.schedule({ collection: "posts", id: doc.id, unpublishAt: at(5) }), "VALIDATION");
    expect(order.issues?.[0]?.path).toEqual(["unpublishAt"]);
    await expectError(xenon.schedule({ collection: "posts", id: doc.id, publishAt: "soon" }), "VALIDATION");
    expect(await xenon.getSchedule({ collection: "posts", id: doc.id })).toEqual({ publishAt: on.toISOString(), unpublishAt: off.toISOString() });
    expect(await xenon.schedule({ collection: "posts", id: doc.id, publishAt: null, unpublishAt: null })).toEqual({ publishAt: null, unpublishAt: null });

    await expectError(xenon.schedule({ collection: "posts", id: doc.id, unpublishAt: off, overrideAccess: false }), "UNAUTHORIZED");
    await expectError(xenon.schedule({ collection: "posts", id: "missing", unpublishAt: off }), "NOT_FOUND");
  });

  test("published reads hide a document from its unpublishAt on, before cron runs (find, findById, findBySlug, populate)", async () => {
    const { xenon, db } = setup();
    const author = await xenon.create({ collection: "authors", data: { name: "Ada" } });
    const post = await xenon.create({ collection: "posts", data: { title: "Hello", author: author.id } });
    await xenon.schedule({ collection: "authors", id: author.id, unpublishAt: at(30) });
    expect((await xenon.findById({ collection: "authors", id: author.id }))?.name).toBe("Ada");

    // Move the unpublish time into the past without going through validation.
    await db.update("authors", author.id, { unpublishAt: new Date(Date.now() - 1000) });
    expect(await xenon.findById({ collection: "authors", id: author.id })).toBeNull();
    expect((await xenon.find({ collection: "authors" })).totalDocs).toBe(0);
    expect((await xenon.findById({ collection: "authors", id: author.id, draft: true }))?.name).toBe("Ada");
    const populated = await xenon.findById({ collection: "posts", id: post.id, populate: { author: true } });
    expect(populated?.author).toBeNull();
    expect((await xenon.findBySlug({ collection: "posts", slug: "hello" }))?.id).toBe(post.id);
  });

  test("runScheduled publishes due drafts and unpublishes expired documents through the write path", async () => {
    const events: string[] = [];
    const { xenon } = setup(memoryAdapter(), (e) => events.push(`${e.op}:${e.id}`));
    const draft = await xenon.create({ collection: "posts", data: { title: "Launch" }, draft: true });
    const live = await xenon.create({ collection: "posts", data: { title: "Promo" } });
    await xenon.update({ collection: "posts", id: live.id, data: { summary: "pending change" }, draft: true });
    await xenon.schedule({ collection: "posts", id: draft.id, publishAt: at(5), unpublishAt: at(60) });
    await xenon.schedule({ collection: "posts", id: live.id, publishAt: at(5) });
    const later = await xenon.create({ collection: "posts", data: { title: "Later" }, draft: true });
    await xenon.schedule({ collection: "posts", id: later.id, publishAt: at(120) });

    const first = await xenon.runScheduled({ now: at(10) });
    expect(first.published.map((r) => r.id).sort()).toEqual([draft.id, live.id].sort());
    expect(first.unpublished).toEqual([]);
    expect(first.failed).toEqual([]);
    expect((await xenon.findById({ collection: "posts", id: draft.id }))?.title).toBe("Launch");
    expect((await xenon.findById({ collection: "posts", id: live.id }))?.summary).toBe("pending change");
    // The publish consumed publishAt; the unpublish is still pending.
    expect(await xenon.getSchedule({ collection: "posts", id: draft.id })).toEqual({ publishAt: null, unpublishAt: expect.any(String) });
    expect((await xenon.findVersions({ collection: "posts", id: draft.id })).docs[0]?.kind).toBe("publish");
    expect(events).toContain(`update:${draft.id}`);

    const second = await xenon.runScheduled({ now: at(90) });
    expect(second.unpublished).toEqual([{ collection: "posts", id: draft.id }]);
    expect(await xenon.findById({ collection: "posts", id: draft.id })).toBeNull();
    expect(await xenon.getSchedule({ collection: "posts", id: draft.id })).toEqual({ publishAt: null, unpublishAt: null });
    expect(events).toContain(`unpublish:${draft.id}`);
    expect((await xenon.runScheduled({ now: at(90) })).published).toEqual([]);
  });

  test("a scheduled publish that fails validation is reported once and its schedule cleared; manual publish and unpublish clear schedules", async () => {
    const { xenon } = setup();
    const broken = await xenon.create({ collection: "posts", data: { summary: "no title" }, draft: true });
    await xenon.schedule({ collection: "posts", id: broken.id, publishAt: at(1) });
    const run = await xenon.runScheduled({ now: at(2) });
    expect(run.failed).toEqual([{ collection: "posts", id: broken.id, action: "publish", message: "The submitted data is invalid." }]);
    expect((await xenon.getSchedule({ collection: "posts", id: broken.id })).publishAt).toBeNull();
    expect((await xenon.runScheduled({ now: at(3) })).failed).toEqual([]);

    const doc = await xenon.create({ collection: "posts", data: { title: "Manual" }, draft: true });
    await xenon.schedule({ collection: "posts", id: doc.id, publishAt: at(30), unpublishAt: at(60) });
    await xenon.update({ collection: "posts", id: doc.id, data: {} });
    expect(await xenon.getSchedule({ collection: "posts", id: doc.id })).toEqual({ publishAt: null, unpublishAt: expect.any(String) });
    await xenon.unpublish({ collection: "posts", id: doc.id });
    expect(await xenon.getSchedule({ collection: "posts", id: doc.id })).toEqual({ publishAt: null, unpublishAt: null });
  });

  test("scheduling needs drafts and adapter support", async () => {
    const { xenon } = setup();
    const page = await xenon.create({ collection: "pages", data: { title: "P" } });
    expect(xenon.supportsScheduling).toBe(true);
    await expectError(xenon.schedule({ collection: "pages", id: page.id, unpublishAt: at(5) }), "BAD_REQUEST");
    const bare = memoryAdapter();
    delete bare.findDue;
    const plain = setup(bare).xenon;
    expect(plain.supportsScheduling).toBe(false);
    await expectError(plain.runScheduled(), "NOT_IMPLEMENTED");
  });
});
