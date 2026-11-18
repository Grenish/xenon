import { describe, expect, test } from "bun:test";
import { memoryAdapter } from "../../src/adapters/memory";
import { defineCollection, defineConfig, text } from "../../src/index";
import { createApiHandler } from "../../src/next/api-handler";
import { signPresenceToken } from "../../src/server/presence";
import { memoryPresence } from "../../src/server/presence";
import { createXenon } from "../../src/server/xenon";

const SECRET = "concurrency-test-secret-abcdefghijklmnopqrstuvwxyz";
const posts = defineCollection({ slug: "posts", fields: { title: text({ required: true }) } });

function setup(presence?: false) {
  const config = defineConfig({
    collections: [posts], db: memoryAdapter(), presence: presence === false ? false : memoryPresence(),
    auth: { secret: SECRET, baseURL: "http://localhost:3000", apiKeys: [{ key: "k", role: "admin" }] },
  });
  const xenon = createXenon(config);
  const handlers = createApiHandler(config, { xenon });
  const call = (method: "POST" | "PATCH", path: string, body: unknown, headers: Record<string, string> = {}) => {
    const url = new URL(`/api/xenon/${path}`, "http://localhost:3000");
    return handlers[method](
      new Request(url, { method, headers: { "content-type": "application/json", authorization: "Bearer k", ...headers }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ slug: path.split("/") }) },
    );
  };
  return { xenon, call };
}

describe("save-conflict check", () => {
  test("Local API: a save based on an old version is refused, the current one goes through", async () => {
    const { xenon } = setup();
    const created = await xenon.create({ collection: "posts", data: { title: "One" }, overrideAccess: true });
    const v1 = (created as { updatedAt: string }).updatedAt;
    const saved = await xenon.update({ collection: "posts", id: created.id, data: { title: "Two" }, expectedUpdatedAt: v1, overrideAccess: true });
    await expect(xenon.update({ collection: "posts", id: created.id, data: { title: "Stale" }, expectedUpdatedAt: v1, overrideAccess: true }))
      .rejects.toMatchObject({ code: "CONFLICT", issues: [{ path: ["updatedAt"] }] });
    const current = await xenon.findById({ collection: "posts", id: created.id, overrideAccess: true });
    expect(current?.title).toBe("Two");
    // Without expectedUpdatedAt, behaviour is unchanged (last write wins).
    await xenon.update({ collection: "posts", id: created.id, data: { title: "Three" }, overrideAccess: true });
    expect((saved as { updatedAt: string }).updatedAt > v1).toBe(true);
  });

  test("REST: If-Match with a stale updatedAt answers 409", async () => {
    const { call } = setup();
    const created = (await (await call("POST", "posts", { title: "One" })).json()) as { id: string; updatedAt: string };
    const ok = await call("PATCH", `posts/${created.id}`, { title: "Two" }, { "if-match": `"${created.updatedAt}"` });
    expect(ok.status).toBe(200);
    const stale = await call("PATCH", `posts/${created.id}`, { title: "Stale" }, { "if-match": `"${created.updatedAt}"` });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { errors: { path?: string[] }[] }).errors[0]?.path).toEqual(["updatedAt"]);
  });
});

describe("presence route", () => {
  const maya = { id: "u1", name: "Maya", email: "maya@example.com" };
  const tom = { id: "u2", name: "Tom", email: "tom@example.com" };

  test("rejects a missing or bad token without touching anything else", async () => {
    const { call } = setup();
    expect((await call("POST", "_presence", { tab: "a" })).status).toBe(401);
    expect((await call("POST", "_presence", { token: "x.y", tab: "a" })).status).toBe(401);
  });

  test("two users: lock, peers and leave", async () => {
    const { call } = setup();
    const [tm, tt] = await Promise.all([signPresenceToken(SECRET, maya), signPresenceToken(SECRET, tom)]);
    const location = { collection: "posts", id: "p1", title: "Hello" };
    const a = await (await call("POST", "_presence", { token: tm, tab: "a", location, intent: "edit" })).json();
    expect(a).toMatchObject({ you: { editing: true }, peers: [] });
    const b = await (await call("POST", "_presence", { token: tt, tab: "b", location, intent: "edit" })).json();
    expect(b).toMatchObject({ you: { editing: false }, peers: [{ user: maya, editing: true, location }] });
    // Unknown collections are not echoed back to other users.
    const c = await (await call("POST", "_presence", { token: tt, tab: "c", location: { collection: "secret" }, intent: "view" })).json();
    expect((c as { peers: { location: unknown }[] }).peers.every((p) => p.location !== null)).toBe(true);
    expect((await call("POST", "_presence", { token: tm, tab: "a", leave: true })).status).toBe(204);
    const after = await (await call("POST", "_presence", { token: tt, tab: "b", location, intent: "edit" })).json();
    expect(after).toMatchObject({ you: { editing: true } });
  });

  test("presence: false turns the route off", async () => {
    const { call } = setup(false);
    expect((await call("POST", "_presence", { token: await signPresenceToken(SECRET, maya), tab: "a" })).status).toBe(404);
  });
});
