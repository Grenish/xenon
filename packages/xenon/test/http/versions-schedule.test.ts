import { afterEach, describe, expect, test } from "bun:test";
import { memoryAdapter } from "../../src/adapters/memory";
import { createHandler } from "../../src/http/index";
import { defineCollection, defineConfig, text } from "../../src/index";
import { createXenon } from "../../src/server/xenon";

const posts = defineCollection({
  slug: "posts",
  versions: true,
  fields: { title: text({ required: true }), body: text() },
});

function setup(cron?: { secret?: string }) {
  const config = defineConfig({
    collections: [posts],
    db: memoryAdapter(),
    cron,
    auth: {
      secret: "versions-http-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
      baseURL: "http://localhost:3000",
      apiKeys: [
        { key: "editor-key", role: "editor", name: "ed" },
        { key: "admin-key", role: "admin", name: "adm" },
      ],
    },
  });
  const xenon = createXenon(config);
  const handler = createHandler(config, { xenon });
  const call = (method: string, path: string, init: { key?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    handler(new Request(`http://localhost:3000/api/xenon${path}`, {
      method,
      headers: {
        ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    }));
  return { xenon, call };
}

const savedEnv = { XENON_CRON_SECRET: process.env.XENON_CRON_SECRET, CRON_SECRET: process.env.CRON_SECRET };
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("REST: versions", () => {
  test("list, read and restore versions; private responses; If-Match; auth", async () => {
    const { xenon, call } = setup();
    const doc = await xenon.create({ collection: "posts", data: { title: "First" } });
    const updated = await xenon.update({ collection: "posts", id: doc.id, data: { title: "Second", body: "b" } });

    const list = await call("GET", `/posts/${doc.id}/versions?limit=1`, { key: "editor-key" });
    expect(list.status).toBe(200);
    expect(list.headers.get("cache-control")).toContain("no-store");
    const page = (await list.json()) as { docs: { id: string; kind: string; doc: { title: string } }[]; totalDocs: number; hasNextPage: boolean };
    expect(page.totalDocs).toBe(2);
    expect(page.hasNextPage).toBe(true);
    expect(page.docs[0]?.doc.title).toBe("Second");

    const all = (await (await call("GET", `/posts/${doc.id}/versions`, { key: "editor-key" })).json()) as typeof page;
    const first = all.docs[1]!;
    const one = await call("GET", `/posts/${doc.id}/versions/${first.id}`, { key: "editor-key" });
    expect(((await one.json()) as { doc: { title: string } }).doc.title).toBe("First");
    expect((await call("GET", `/posts/other-doc/versions/${first.id}`, { key: "editor-key" })).status).toBe(404);
    expect((await call("GET", `/posts/${doc.id}/versions`)).status).toBe(401);
    expect((await call("GET", `/posts/${doc.id}/versions?limit=zero`, { key: "editor-key" })).status).toBe(400);

    const stale = await call("POST", `/posts/${doc.id}/versions/${first.id}/restore`, { key: "editor-key", headers: { "if-match": `"${doc.updatedAt}"` } });
    expect(stale.status).toBe(409);
    const restored = await call("POST", `/posts/${doc.id}/versions/${first.id}/restore`, { key: "editor-key", headers: { "if-match": `"${updated.updatedAt}"` } });
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as { title: string }).title).toBe("First");
    // Draft restore: the live document is unchanged.
    expect((await xenon.findById({ collection: "posts", id: doc.id }))?.title).toBe("Second");
    const published = await call("POST", `/posts/${doc.id}/versions/${first.id}/restore?draft=false`, { key: "editor-key" });
    expect(published.status).toBe(200);
    expect((await xenon.findById({ collection: "posts", id: doc.id }))?.title).toBe("First");
    expect((await call("DELETE", `/posts/${doc.id}/versions`, { key: "editor-key" })).status).toBe(404);
  });
});

describe("REST: schedules and cron", () => {
  test("read and set a schedule; validation errors are 400; cookie-less API keys need no Origin", async () => {
    const { xenon, call } = setup();
    const doc = await xenon.create({ collection: "posts", data: { title: "Draft" }, draft: true });
    const publishAt = new Date(Date.now() + 3_600_000).toISOString();
    const set = await call("PUT", `/posts/${doc.id}/schedule`, { key: "editor-key", body: { publishAt } });
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ publishAt, unpublishAt: null });
    expect(await (await call("GET", `/posts/${doc.id}/schedule`, { key: "editor-key" })).json()).toEqual({ publishAt, unpublishAt: null });
    expect((await call("PUT", `/posts/${doc.id}/schedule`, { key: "editor-key", body: { unpublishAt: 5 } })).status).toBe(400);
    expect((await call("PUT", `/posts/${doc.id}/schedule`, { key: "editor-key", body: { unpublishAt: publishAt } })).status).toBe(400);
    expect((await call("PUT", `/posts/${doc.id}/schedule`, { body: { publishAt: null } })).status).toBe(401);
  });

  test("cron runs due work with the configured secret, env secret, or an admin; refuses others", async () => {
    const { xenon, call } = setup({ secret: "cron-secret" });
    const doc = await xenon.create({ collection: "posts", data: { title: "Due" }, draft: true });
    await xenon.schedule({ collection: "posts", id: doc.id, publishAt: new Date(Date.now() - 1000) });

    expect((await call("POST", "/_cron/publish")).status).toBe(401);
    expect((await call("POST", "/_cron/publish", { key: "wrong" })).status).toBe(401);
    expect((await call("POST", "/_cron/publish", { key: "editor-key" })).status).toBe(403);
    expect((await call("DELETE", "/_cron/publish", { key: "cron-secret" })).status).toBe(404);

    const run = await call("GET", "/_cron/publish", { key: "cron-secret" });
    expect(run.status).toBe(200);
    expect(run.headers.get("cache-control")).toContain("no-store");
    expect(await run.json()).toEqual({ published: [{ collection: "posts", id: doc.id }], unpublished: [], failed: [] });
    expect((await xenon.findById({ collection: "posts", id: doc.id }))?.title).toBe("Due");

    expect((await call("POST", "/_cron/publish", { key: "admin-key" })).status).toBe(200);

    process.env.CRON_SECRET = "vercel-secret";
    const env = setup();
    expect((await env.call("GET", "/_cron/publish", { key: "vercel-secret" })).status).toBe(200);
    process.env.XENON_CRON_SECRET = "xenon-secret";
    expect((await setup().call("GET", "/_cron/publish", { key: "xenon-secret" })).status).toBe(200);
  });
});

describe("admin actions and client config", () => {
  test("doc.versions, doc.restoreVersion, doc.schedule and autosave saves", async () => {
    const { dispatchAdminAction } = await import("../../src/http/admin-action");
    const { config, xenon } = (() => {
      const config = defineConfig({
        collections: [defineCollection({ slug: "posts", versions: true, admin: { autosave: true }, fields: { title: text({ required: true }) } })],
        db: memoryAdapter(),
        auth: { secret: "versions-admin-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz", baseURL: "http://localhost:3000", apiKeys: [{ key: "admin-key", role: "admin" }] },
      });
      return { config, xenon: createXenon(config) };
    })();
    const headers = new Headers({ authorization: "Bearer admin-key" });
    const run = <T>(input: Parameters<typeof dispatchAdminAction>[1]) =>
      dispatchAdminAction(config, input, headers, { xenon }) as Promise<{ ok: true; data: T } | { ok: false; error: { code: string; message: string } }>;

    const created = await run<{ id: string; updatedAt: string }>({ type: "doc.save", collection: "posts", data: { title: "One" }, draft: false });
    if (!created.ok) throw new Error(created.error.message);
    const id = created.data.id;
    const auto = await run<{ updatedAt: string }>({ type: "doc.save", collection: "posts", id, data: { title: "Typing" }, draft: true, autosave: true });
    expect(auto.ok).toBe(true);
    await run({ type: "doc.save", collection: "posts", id, data: { title: "Two" }, draft: false });

    const versions = await run<{ docs: { id: string; kind: string; data: Record<string, unknown> }[]; totalDocs: number }>({ type: "doc.versions", collection: "posts", id });
    if (!versions.ok) throw new Error(versions.error.message);
    // The autosave added no version; system keys are not part of `data`.
    expect(versions.data.docs.map((v) => [v.kind, v.data.title])).toEqual([["publish", "Two"], ["publish", "One"]]);
    expect(Object.keys(versions.data.docs[0]!.data)).toEqual(["title"]);

    const restored = await run<{ data: { title: string }; hasUnpublishedChanges: boolean }>({ type: "doc.restoreVersion", collection: "posts", id, versionId: versions.data.docs[1]!.id });
    expect(restored.ok && restored.data.data.title).toBe("One");
    expect(restored.ok && restored.data.hasUnpublishedChanges).toBe(true);
    const wrongDoc = await run({ type: "doc.restoreVersion", collection: "posts", id: "other", versionId: versions.data.docs[1]!.id });
    expect(!wrongDoc.ok && wrongDoc.error.code).toBe("NOT_FOUND");

    const publishAt = new Date(Date.now() + 60_000).toISOString();
    const scheduled = await run<{ publishAt: string | null; unpublishAt: string | null }>({ type: "doc.schedule", collection: "posts", id, publishAt });
    expect(scheduled.ok && scheduled.data).toMatchObject({ publishAt, unpublishAt: null });
    const cleared = await run<{ publishAt: string | null }>({ type: "doc.schedule", collection: "posts", id, publishAt: null });
    expect(cleared.ok && cleared.data.publishAt).toBeNull();
  });

  test("client config exposes versions, scheduling and the autosave interval", async () => {
    const { toClientCollection } = await import("../../src/ui/shared/client-config");
    const versioned = defineCollection({ slug: "a", versions: true, admin: { autosave: { interval: 900 } }, fields: { t: text() } });
    expect(toClientCollection(versioned, { scheduling: true })).toMatchObject({ versions: true, scheduling: true, admin: { autosave: 900 } });
    const plain = defineCollection({ slug: "b", drafts: false, fields: { t: text() } });
    expect(toClientCollection(plain, { scheduling: true })).toMatchObject({ versions: false, scheduling: false, admin: { autosave: null } });
    expect(toClientCollection(versioned).scheduling).toBe(false);
  });

  test("diffVersion lists the fields a version changes, with readable values", async () => {
    const { diffVersion } = await import("../../src/ui/form/version-history");
    const { toClientCollection } = await import("../../src/ui/shared/client-config");
    const { array, richText } = await import("../../src/index");
    const client = toClientCollection(defineCollection({
      slug: "c",
      fields: { title: text(), body: richText(), tags: array({ fields: { name: text() } }), note: text({ admin: { hidden: true } }) },
    }));
    const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }] };
    const { initialData } = await import("../../src/ui/form/model");
    // The editor holds form-shaped values (defaults filled in), like `initialData` builds them.
    const editor = (data: Record<string, unknown>) => initialData(client, { data } as never);
    const changes = diffVersion(client, { title: "Old", body, tags: [{ id: "r1", name: "x" }], note: "a" }, editor({ title: "New", body: null, tags: [{ id: "r1", name: "x" }], note: "b" }));
    expect(changes.map((c) => [c.field.name, c.version, c.current])).toEqual([["title", "Old", "New"], ["body", "Hello world", "—"]]);
    const rows = diffVersion(client, { tags: [{ id: "r1", name: "x" }] }, editor({ tags: [{ id: "r1", name: "y" }] }));
    expect(rows.map((c) => [c.field.name, c.version, c.current])).toEqual([["tags", '[{"name":"x"}]', '[{"name":"y"}]']]);
  });
});
