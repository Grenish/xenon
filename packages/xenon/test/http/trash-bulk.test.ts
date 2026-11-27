import { describe, expect, test } from "bun:test";
import { memoryAdapter } from "../../src/adapters/memory";
import { dispatchAdminAction, dispatchAdminActionWithHeaders } from "../../src/http/admin-action";
import { loadAdminData } from "../../src/http/admin-loader";
import { createHandler } from "../../src/http/index";
import { boolean, date, defineCollection, defineConfig, number, select, text } from "../../src/index";
import { createXenon } from "../../src/server/xenon";
import { toClientCollection } from "../../src/ui/shared/client-config";
import { filterOps, listFiltersToWhere, parseListFilters, serializeListFilters } from "../../src/ui/shared/list-filters";

const posts = defineCollection({
  slug: "posts",
  slugFrom: "title",
  trash: true,
  fields: {
    title: text({ required: true }),
    category: select({ options: ["news", "guide"] }),
    tags: select({ options: ["a", "b"], hasMany: true }),
    views: number(),
    featured: boolean({ defaultValue: false }),
    launch: date(),
    secret: text({ admin: { hidden: true } }),
  },
});

function setup() {
  const config = defineConfig({
    collections: [posts],
    db: memoryAdapter(),
    auth: {
      secret: "trash-http-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
      baseURL: "http://localhost:3000",
      apiKeys: [{ key: "admin-key", role: "admin" }, { key: "editor-key", role: "editor" }],
    },
  });
  const xenon = createXenon(config);
  const handler = createHandler(config, { xenon });
  const call = (method: string, path: string, init: { body?: unknown } = {}) =>
    handler(new Request(`http://localhost:3000/api/xenon${path}`, {
      method,
      headers: { authorization: "Bearer editor-key", ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    }));
  const headers = new Headers({ authorization: "Bearer admin-key" });
  const action = <T>(input: Parameters<typeof dispatchAdminAction>[1]) =>
    dispatchAdminAction(config, input, headers, { xenon }) as Promise<{ ok: true; data: T } | { ok: false; error: { code: string; message: string } }>;
  return { config, xenon, call, action, headers };
}

describe("REST: trash, restore, purge, duplicate", () => {
  test("DELETE trashes, ?trash=true lists, POST restore, DELETE ?permanent=true purges, POST duplicate copies", async () => {
    const { xenon, call } = setup();
    const doc = await xenon.create({ collection: "posts", data: { title: "Hello", category: "news" } });

    expect((await call("DELETE", `/posts/${doc.id}`)).status).toBe(200);
    expect((await call("GET", `/posts/${doc.id}`)).status).toBe(404);
    const bin = await call("GET", "/posts?trash=true");
    expect(bin.headers.get("cache-control")).toContain("no-store");
    expect(((await bin.json()) as { docs: { id: string }[] }).docs.map((d) => d.id)).toEqual([doc.id]);
    expect((await call("GET", "/posts?trash=maybe")).status).toBe(400);

    const restored = await call("POST", `/posts/${doc.id}/restore`);
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as { title: string }).title).toBe("Hello");

    const copy = await call("POST", `/posts/${doc.id}/duplicate`, { body: { data: { title: "Hello again" } } });
    expect(copy.status).toBe(201);
    expect(await copy.json()).toMatchObject({ title: "Hello again", category: "news", status: "draft", slug: "hello-again" });
    expect((await call("POST", `/posts/${doc.id}/duplicate`)).status).toBe(201);
    expect((await call("POST", `/posts/${doc.id}/duplicate`, { body: { data: 5 } })).status).toBe(400);

    expect((await call("DELETE", `/posts/${doc.id}?permanent=true`)).status).toBe(200);
    expect((await call("POST", `/posts/${doc.id}/restore`)).status).toBe(404);
    expect((await xenon.find({ collection: "posts", trash: true })).totalDocs).toBe(0);
  });
});

describe("admin: duplicate, bulk and the list", () => {
  test("doc.duplicate titles the copy; doc.bulk reports per document", async () => {
    const { xenon, action } = setup();
    const a = await xenon.create({ collection: "posts", data: { title: "A" }, draft: true });
    const b = await xenon.create({ collection: "posts", data: { title: "B" }, draft: true });
    const broken = await xenon.create({ collection: "posts", data: {}, draft: true });

    const copy = await action<{ id: string; data: { title: string }; status: string }>({ type: "doc.duplicate", collection: "posts", id: a.id });
    expect(copy.ok && copy.data.data.title).toBe("A (copy)");
    expect(copy.ok && copy.data.status).toBe("draft");

    const published = await action<{ done: string[]; failed: { id: string; message: string }[] }>({ type: "doc.bulk", collection: "posts", ids: [a.id, b.id, broken.id], action: "publish" });
    if (!published.ok) throw new Error(published.error.message);
    expect(published.data.done.sort()).toEqual([a.id, b.id].sort());
    expect(published.data.failed.map((f) => f.id)).toEqual([broken.id]);
    expect((await xenon.find({ collection: "posts" })).totalDocs).toBe(2);

    const trashed = await action<{ done: string[] }>({ type: "doc.bulk", collection: "posts", ids: [a.id, b.id], action: "delete" });
    expect(trashed.ok && trashed.data.done.length).toBe(2);
    const back = await action<{ done: string[] }>({ type: "doc.bulk", collection: "posts", ids: [a.id], action: "restore" });
    expect(back.ok && back.data.done).toEqual([a.id]);
    const purged = await action<{ done: string[] }>({ type: "doc.bulk", collection: "posts", ids: [b.id], action: "purge" });
    expect(purged.ok && purged.data.done).toEqual([b.id]);
    expect((await xenon.find({ collection: "posts", trash: true })).totalDocs).toBe(0);

    const tooMany = await action({ type: "doc.bulk", collection: "posts", ids: Array.from({ length: 101 }, (_, i) => `id-${i}`), action: "publish" });
    expect(!tooMany.ok && tooMany.error.code).toBe("BAD_REQUEST");
    const unknown = await action({ type: "doc.bulk", collection: "posts", ids: [a.id], action: "explode" as never });
    expect(!unknown.ok && unknown.error.code).toBe("BAD_REQUEST");
  });

  test("the list loader applies ?filter= and shows the trash with deletion times", async () => {
    const { config, xenon } = setup();
    await xenon.create({ collection: "posts", data: { title: "News 1", category: "news", views: 10 } });
    await xenon.create({ collection: "posts", data: { title: "News 2", category: "news", views: 500 } });
    await xenon.create({ collection: "posts", data: { title: "Guide", category: "guide", views: 900, featured: true } });
    const gone = await xenon.create({ collection: "posts", data: { title: "Gone", category: "news" } });
    await xenon.delete({ collection: "posts", id: gone.id });

    // The admin loader needs a signed-in session (API keys are refused there).
    const signup = await dispatchAdminActionWithHeaders(config, { type: "auth.setup", name: "Ada", email: "ada@example.com", password: "password123" }, new Headers(), { xenon, captureHeaders: true });
    const cookie = (signup.headers?.getSetCookie() ?? []).map((c) => c.split(";")[0]).join("; ");
    const session = new Headers({ cookie });
    const load = (query: Record<string, string>) => loadAdminData({ config, xenon, segments: ["collections", "posts"], query: new URLSearchParams(query), headers: session });
    const filter = serializeListFilters([{ field: "category", op: "equals", value: "news" }, { field: "views", op: "gt", value: 100 }])!;
    const list = await load({ filter });
    if (list.kind !== "collection-list") throw new Error(list.kind);
    expect(list.rows.map((r) => r.title)).toEqual(["News 2"]);
    expect(list.query.filter).toEqual([{ field: "category", op: "equals", value: "news" }, { field: "views", op: "gt", value: 100 }]);

    const notFeatured = await load({ filter: serializeListFilters([{ field: "featured", op: "equals", value: false }])! });
    if (notFeatured.kind !== "collection-list") throw new Error(notFeatured.kind);
    // A missing boolean reads as its default (false) and matches.
    expect(notFeatured.rows.map((r) => r.title).sort()).toEqual(["News 1", "News 2"]);

    const trash = await load({ status: "trash" });
    if (trash.kind !== "collection-list") throw new Error(trash.kind);
    expect(trash.query.status).toBe("trash");
    expect(trash.rows.map((r) => r.title)).toEqual(["Gone"]);
    expect(typeof trash.rows[0]!.deletedAt).toBe("string");
    expect(trash.collection.trash).toBe(true);
  });
});

describe("list filters", () => {
  const fields = toClientCollection(posts).fields;

  test("operators follow the field type; hidden and unfilterable fields are left out", () => {
    const op = (name: string) => filterOps(fields.find((f) => f.name === name)!);
    expect(op("title")).toContain("contains");
    expect(op("tags")).toEqual(["contains", "exists", "not_exists"]);
    expect(op("category")).toEqual(["equals", "not_equals", "exists", "not_exists"]);
    expect(op("featured")).toEqual(["equals"]);
    expect(op("launch")).toEqual(["gt", "lt", "exists", "not_exists"]);
  });

  test("parsing keeps only valid filters, coerces values, and never throws", () => {
    expect(parseListFilters("not json", fields)).toEqual([]);
    expect(parseListFilters('{"a":1}', fields)).toEqual([]);
    const parsed = parseListFilters(JSON.stringify([
      { field: "views", op: "gt", value: "5" },
      { field: "featured", op: "equals", value: "true" },
      { field: "launch", op: "lt", value: "2030-01-01" },
      { field: "category", op: "equals", value: "nope" },
      { field: "secret", op: "contains", value: "x" },
      { field: "title", op: "gt", value: "x" },
      { field: "title", op: "exists", value: "ignored" },
      { field: "missing", op: "equals", value: "x" },
    ]), fields);
    expect(parsed).toEqual([
      { field: "views", op: "gt", value: 5 },
      { field: "featured", op: "equals", value: true },
      { field: "launch", op: "lt", value: "2030-01-01T00:00:00.000Z" },
      { field: "title", op: "exists" },
    ]);
    expect(listFiltersToWhere(parsed)).toEqual([
      { views: { gt: 5 } },
      { featured: { equals: true } },
      { launch: { lt: "2030-01-01T00:00:00.000Z" } },
      { title: { exists: true } },
    ]);
    expect(parseListFilters(JSON.stringify(Array.from({ length: 20 }, () => ({ field: "title", op: "exists" }))), fields)).toHaveLength(10);
    expect(serializeListFilters([])).toBeNull();
  });
});
