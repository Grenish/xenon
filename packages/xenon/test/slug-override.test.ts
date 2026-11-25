import { describe, expect, test } from "bun:test";
import { memoryAdapter } from "../src/adapters/memory";
import { createHandler } from "../src/http/index";
import { toAdminDoc } from "../src/http/admin-action";
import { defineCollection, defineConfig, text } from "../src/index";
import { createXenon } from "../src/server/xenon";

const posts = defineCollection({
  slug: "posts",
  slugFrom: "title",
  fields: { title: text({ required: true }), body: text() },
});
const notes = defineCollection({ slug: "notes", drafts: false, fields: { title: text({ required: true }) } });

function setup() {
  const db = memoryAdapter();
  const config = defineConfig({
    collections: [posts, notes],
    db,
    auth: {
      secret: "slug-override-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
      baseURL: "http://localhost:3000",
      apiKeys: [{ key: "editor-key", role: "editor", name: "ed" }],
    },
  });
  const xenon = createXenon(config);
  return { db, config, xenon, handler: createHandler(config, { xenon }) };
}
const sys = { overrideAccess: true } as const;

describe("Local API slug override", () => {
  test("create with a hand-set slug: normalized, and it stops following the title", async () => {
    const { xenon } = setup();
    const doc = await xenon.create({ ...sys, collection: "posts", draft: true, data: { title: "Hello World" }, slug: "  My Custom Slug! " });
    expect(doc.slug).toBe("my-custom-slug");
    const renamed = await xenon.update({ ...sys, collection: "posts", id: doc.id, draft: true, data: { title: "Something else" } });
    expect(renamed.slug).toBe("my-custom-slug");
  });

  test("automatic slugs still follow the title until first publish", async () => {
    const { xenon } = setup();
    const doc = await xenon.create({ ...sys, collection: "posts", draft: true, data: { title: "First" } });
    const renamed = await xenon.update({ ...sys, collection: "posts", id: doc.id, draft: true, data: { title: "Second" } });
    expect(renamed.slug).toBe("second");
  });

  test("a taken slug is refused with CONFLICT on path slug (no silent -2 suffix)", async () => {
    const { xenon } = setup();
    await xenon.create({ ...sys, collection: "posts", data: { title: "Taken" } });
    const other = await xenon.create({ ...sys, collection: "posts", data: { title: "Other" } });
    await expect(xenon.update({ ...sys, collection: "posts", id: other.id, data: {}, slug: "Taken" })).rejects.toMatchObject({
      code: "CONFLICT",
      issues: [{ path: ["slug"] }],
    });
    // Its own slug is not a conflict.
    const same = await xenon.update({ ...sys, collection: "posts", id: other.id, data: {}, slug: "other" });
    expect(same.slug).toBe("other");
  });

  test("empty or non-string slugs are validation errors", async () => {
    const { xenon } = setup();
    await expect(xenon.create({ ...sys, collection: "posts", data: { title: "x" }, slug: "!!!" })).rejects.toMatchObject({
      code: "VALIDATION",
      issues: [{ path: ["slug"], message: "Use at least one letter or number" }],
    });
    await expect(xenon.create({ ...sys, collection: "posts", data: { title: "x" }, slug: 42 as never })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  test("null switches back to automatic", async () => {
    const { xenon } = setup();
    const doc = await xenon.create({ ...sys, collection: "posts", draft: true, data: { title: "Auto Again" }, slug: "custom" });
    const reset = await xenon.update({ ...sys, collection: "posts", id: doc.id, draft: true, data: {}, slug: null });
    expect(reset.slug).toBe("auto-again");
    const renamed = await xenon.update({ ...sys, collection: "posts", id: doc.id, draft: true, data: { title: "Follows" } });
    expect(renamed.slug).toBe("follows");
  });

  test("published documents: a draft slug change stays pending until publish", async () => {
    const { xenon } = setup();
    const doc = await xenon.create({ ...sys, collection: "posts", data: { title: "Launch" } });
    expect(doc.slug).toBe("launch");
    const draft = await xenon.update({ ...sys, collection: "posts", id: doc.id, draft: true, data: { body: "edit" }, slug: "launch-2026" });
    // The draft view shows the pending slug; the live document keeps its URL.
    expect(draft.slug).toBe("launch-2026");
    expect((await xenon.findBySlug({ ...sys, collection: "posts", slug: "launch" }))?.id).toBe(doc.id);
    // Another draft save without a slug keeps the pending change.
    const again = await xenon.update({ ...sys, collection: "posts", id: doc.id, draft: true, data: { body: "edit 2" } });
    expect(again.slug).toBe("launch-2026");
    // Publishing applies it.
    const live = await xenon.update({ ...sys, collection: "posts", id: doc.id, data: {} });
    expect(live.slug).toBe("launch-2026");
    expect(await xenon.findBySlug({ ...sys, collection: "posts", slug: "launch" })).toBeNull();
    // And the hand-set slug no longer follows the title.
    const retitled = await xenon.update({ ...sys, collection: "posts", id: doc.id, data: { title: "Renamed" }, slug: undefined });
    expect(retitled.slug).toBe("launch-2026");
  });

  test("a pending slug that got taken meanwhile is refused at publish", async () => {
    const { xenon } = setup();
    const doc = await xenon.create({ ...sys, collection: "posts", data: { title: "One" } });
    await xenon.update({ ...sys, collection: "posts", id: doc.id, draft: true, data: {}, slug: "wanted" });
    await xenon.create({ ...sys, collection: "posts", data: { title: "Wanted" } });
    await expect(xenon.update({ ...sys, collection: "posts", id: doc.id, data: {} })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("published automatic slugs stay frozen when the title changes", async () => {
    const { xenon } = setup();
    const doc = await xenon.create({ ...sys, collection: "posts", data: { title: "Frozen" } });
    const renamed = await xenon.update({ ...sys, collection: "posts", id: doc.id, data: { title: "Thawed?" } });
    expect(renamed.slug).toBe("frozen");
  });

  test("collections without slugFrom (and without drafts) can be given a slug", async () => {
    const { xenon } = setup();
    const note = await xenon.create({ ...sys, collection: "notes", data: { title: "N" } });
    expect(note.slug).toBeNull();
    const slugged = await xenon.update({ ...sys, collection: "notes", id: note.id, data: {}, slug: "the-note" });
    expect(slugged.slug).toBe("the-note");
  });

  test("toAdminDoc exposes the live slug and the manual flag", async () => {
    const { db, xenon } = setup();
    const doc = await xenon.create({ ...sys, collection: "posts", data: { title: "Live" } });
    const draft = await xenon.update({ ...sys, collection: "posts", id: doc.id, draft: true, data: {}, slug: "next" });
    const admin = toAdminDoc(draft as Record<string, unknown>, await db.findById("posts", doc.id));
    expect(admin).toMatchObject({ slug: "next", liveSlug: "live", slugManual: false });
    const published = await xenon.update({ ...sys, collection: "posts", id: doc.id, data: {} });
    expect(toAdminDoc(published as Record<string, unknown>, await db.findById("posts", doc.id))).toMatchObject({ slug: "next", liveSlug: "next", slugManual: true });
  });
});

describe("REST slug override", () => {
  const send = (handler: ReturnType<typeof setup>["handler"], method: string, path: string, body: unknown) =>
    handler(new Request(`http://localhost:3000/api/xenon/${path}`, {
      method,
      headers: { authorization: "Bearer editor-key", "content-type": "application/json" },
      body: JSON.stringify(body),
    }));

  test("a top-level slug in the body sets it by hand; null resets", async () => {
    const { handler } = setup();
    const created = await send(handler, "POST", "posts", { title: "Via REST", slug: "rest-slug" });
    expect(created.status).toBe(201);
    const doc = (await created.json()) as { id: string; slug: string; title: string };
    expect(doc).toMatchObject({ slug: "rest-slug", title: "Via REST" });
    const reset = await send(handler, "PATCH", `posts/${doc.id}`, { slug: null });
    // Published, so resetting re-derives from the title.
    expect(((await reset.json()) as { slug: string }).slug).toBe("via-rest");
  });

  test("bad slug types and taken slugs", async () => {
    const { handler } = setup();
    expect((await send(handler, "POST", "posts", { title: "x", slug: 5 })).status).toBe(400);
    await send(handler, "POST", "posts", { title: "Taken" });
    const clash = await send(handler, "POST", "posts", { title: "y", slug: "taken" });
    expect(clash.status).toBe(409);
    expect(JSON.stringify(await clash.json())).toContain('"slug"');
  });
});
