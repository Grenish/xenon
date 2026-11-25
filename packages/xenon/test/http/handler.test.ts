import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryAdapter } from "../../src/adapters/memory";
import {
  createHandler,
  loadAdminData,
  matchesIfNoneMatch,
} from "../../src/http/index";
import { boolean, defineCollection, defineConfig, number, text } from "../../src/index";
import { createXenon } from "../../src/server/xenon";
import { LocalStorageAdapter } from "../../src/storage/local";

const posts = defineCollection({
  slug: "posts",
  slugFrom: "title",
  fields: {
    title: text({ required: true }),
    views: number(),
    featured: boolean(),
  },
});

const restricted = defineCollection({
  slug: "secrets",
  fields: { title: text({ required: true }) },
  access: { read: ({ user }) => user?.role === "admin" },
});

const media = defineCollection({
  slug: "media",
  upload: { mimeTypes: ["text/plain"], maxFileSize: 1024 },
  fields: { alt: text({ required: true }) },
});

function makeConfig(directory: string, overrides?: { apiPath?: string }) {
  return defineConfig({
    collections: [posts, restricted, media],
    db: memoryAdapter(),
    storage: new LocalStorageAdapter({ directory }),
    api: overrides?.apiPath ? { path: overrides.apiPath } : undefined,
    auth: {
      secret: "http-handler-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
      baseURL: "http://localhost:3000",
      trustedOrigins: ["https://admin.example"],
      apiKeys: [
        { key: "editor-key", role: "editor", name: "ed" },
        { key: "admin-key", role: "admin", name: "adm" },
      ],
    },
  });
}

describe("xenon-cms/http createHandler", () => {
  let directory: string;
  let config: ReturnType<typeof makeConfig>;
  let xenon: ReturnType<typeof createXenon<ReturnType<typeof makeConfig>>>;
  let handler: ReturnType<typeof createHandler>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "xenon-http-"));
    config = makeConfig(directory);
    xenon = createXenon(config);
    handler = createHandler(config, { xenon });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test("routes by URL pathname relative to config.api.path and custom basePath", async () => {
    const created = await handler(new Request("http://localhost:3000/api/xenon/posts", {
      method: "POST",
      headers: { authorization: "Bearer editor-key", "content-type": "application/json" },
      body: JSON.stringify({ title: "Hello HTTP" }),
    }));
    expect(created.status).toBe(201);
    const doc = (await created.json()) as { id: string; title: string };
    expect(doc.title).toBe("Hello HTTP");

    // Outside api.path returns 404.
    expect((await handler(new Request("http://localhost:3000/other/posts"))).status).toBe(404);
    // Malformed percent encoding returns 400.
    expect((await handler(new Request("http://localhost:3000/api/xenon/posts/%E0%A4%A"))).status).toBe(400);

    // Stripped-prefix host mode (e.g. Hono `.route("/api/xenon", ...)` with basePath: "").
    const stripped = createHandler(config, { xenon, basePath: "" });
    const res = await stripped(new Request(`http://localhost:3000/posts/${doc.id}`));
    expect(res.status).toBe(200);
    expect((await res.json()) as { id: string }).toMatchObject({ id: doc.id, title: "Hello HTTP" });

    // Custom config.api.path.
    const customCfg = makeConfig(directory, { apiPath: "/cms/v1" });
    const customHandler = createHandler(customCfg, { xenon });
    expect((await customHandler(new Request(`http://localhost:3000/cms/v1/posts/${doc.id}`))).status).toBe(200);
    expect((await customHandler(new Request(`http://localhost:3000/api/xenon/posts/${doc.id}`))).status).toBe(404);
  });

  test("adds ETag / 304 and access-aware Cache-Control on GET and HEAD endpoints", async () => {
    const created = await xenon.create({ collection: "posts", data: { title: "Cached Post", views: 1 }, overrideAccess: true });

    // Public list GET -> ETag + public Cache-Control.
    const list1 = await handler(new Request("http://localhost:3000/api/xenon/posts"));
    expect(list1.status).toBe(200);
    const listEtag = list1.headers.get("etag");
    expect(listEtag).toMatch(/^"[0-9a-f]{32}"$/);
    expect(list1.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(list1.headers.get("vary")).toBeNull();

    // Matching strong, weak, multi-tag, and wildcard If-None-Match return 304 with empty body.
    for (const inm of [listEtag!, `W/${listEtag!}`, `"other", ${listEtag!}`, "*"]) {
      const notMod = await handler(new Request("http://localhost:3000/api/xenon/posts", { headers: { "if-none-match": inm } }));
      expect(notMod.status).toBe(304);
      expect(notMod.headers.get("etag")).toBe(listEtag);
      expect(notMod.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
      expect(await notMod.text()).toBe("");
    }

    // Single-document GET + HEAD parity.
    const doc1 = await handler(new Request(`http://localhost:3000/api/xenon/posts/${created.id}`));
    const docEtag = doc1.headers.get("etag")!;
    expect(doc1.status).toBe(200);
    const head1 = await handler(new Request(`http://localhost:3000/api/xenon/posts/${created.id}`, { method: "HEAD" }));
    expect(head1.status).toBe(200);
    expect(head1.headers.get("etag")).toBe(docEtag);
    expect(await head1.text()).toBe("");

    // Mutating the document invalidates the ETag.
    await xenon.update({ collection: "posts", id: created.id, data: { title: "Updated Post" }, overrideAccess: true });
    const doc2 = await handler(new Request(`http://localhost:3000/api/xenon/posts/${created.id}`, { headers: { "if-none-match": docEtag } }));
    expect(doc2.status).toBe(200);
    expect(doc2.headers.get("etag")).not.toBe(docEtag);
    expect(((await doc2.json()) as { title: string }).title).toBe("Updated Post");

    // Draft reads and restricted collections are never publicly cached.
    const draftRes = await handler(new Request(`http://localhost:3000/api/xenon/posts/${created.id}?draft=true`, {
      headers: { authorization: "Bearer editor-key" },
    }));
    expect(draftRes.status).toBe(200);
    expect(draftRes.headers.get("cache-control")).toBe("private, no-store");
    expect(draftRes.headers.get("vary")).toBe("Authorization, Cookie");

    await xenon.create({ collection: "secrets", data: { title: "Classified" }, overrideAccess: true });
    const secretOk = await handler(new Request("http://localhost:3000/api/xenon/secrets", {
      headers: { authorization: "Bearer admin-key" },
    }));
    expect(secretOk.status).toBe(200);
    expect(secretOk.headers.get("cache-control")).toBe("private, no-store");
    expect(secretOk.headers.get("vary")).toBe("Authorization, Cookie");
    const secretEtag = secretOk.headers.get("etag")!;
    // Unauthorized request with the valid ETag still gets 401 (never 304!).
    const secretUnauth = await handler(new Request("http://localhost:3000/api/xenon/secrets", {
      headers: { "if-none-match": secretEtag },
    }));
    expect(secretUnauth.status).toBe(401);
    expect(secretUnauth.headers.get("cache-control")).toBe("private, no-store");

    // Custom cacheControl option for CDN deployments.
    const cdnHandler = createHandler(config, { xenon, cacheControl: "public, s-maxage=60, stale-while-revalidate=300" });
    const cdnRes = await cdnHandler(new Request("http://localhost:3000/api/xenon/posts"));
    expect(cdnRes.headers.get("cache-control")).toBe("public, s-maxage=60, stale-while-revalidate=300");

    // File ETag / 304 support.
    const uploaded = await xenon.create({
      collection: "media",
      data: { alt: "Sample" },
      file: { data: new TextEncoder().encode("hello"), name: "hello.txt", type: "text/plain" },
      overrideAccess: true,
    });
    const fileRes = await handler(new Request(`http://localhost:3000${uploaded.url}`));
    expect(fileRes.status).toBe(200);
    const fileEtag = fileRes.headers.get("etag")!;
    expect(fileEtag).toBeTruthy();
    const file304 = await handler(new Request(`http://localhost:3000${uploaded.url}`, { headers: { "if-none-match": fileEtag } }));
    expect(file304.status).toBe(304);
    expect(await file304.text()).toBe("");
  });

  test("matchesIfNoneMatch handles weak tags, commas inside quotes, and wildcards", () => {
    expect(matchesIfNoneMatch(null, '"abc"')).toBe(false);
    expect(matchesIfNoneMatch("", '"abc"')).toBe(false);
    expect(matchesIfNoneMatch("*", '"abc"')).toBe(true);
    expect(matchesIfNoneMatch('W/"abc"', '"abc"')).toBe(true);
    expect(matchesIfNoneMatch('"x,y", "abc"', '"abc"')).toBe(true);
    expect(matchesIfNoneMatch('"def"', '"abc"')).toBe(false);
  });

  test("HTTP admin transport (/_admin/action and /_admin/data) enforces Origin, session auth, cookies, and matches loadAdminData", async () => {
    // 1. Before any user exists, /_admin/data redirects to setup and does not leak collections.
    const anonRoot = await handler(new Request("http://localhost:3000/api/xenon/_admin/data?path=/admin"));
    expect(anonRoot.status).toBe(200);
    expect(anonRoot.headers.get("cache-control")).toBe("private, no-store");
    expect(await anonRoot.json()).toEqual({ kind: "redirect", to: "/admin/setup", status: 302 });

    const setupScreen = await handler(new Request("http://localhost:3000/api/xenon/_admin/data?path=/admin/setup"));
    expect(setupScreen.status).toBe(200);
    expect(await setupScreen.json()).toMatchObject({
      kind: "auth",
      mode: "setup",
      shell: { collections: [], user: null, presenceToken: null },
    });

    // 2. POST /_admin/action enforces High #5 Origin check even on setup/login.
    const noOrigin = await handler(new Request("http://localhost:3000/api/xenon/_admin/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "auth.setup", name: "Ada", email: "ada@example.com", password: "password123" }),
    }));
    expect(noOrigin.status).toBe(403);
    expect(noOrigin.headers.get("cache-control")).toBe("private, no-store");

    const evilOrigin = await handler(new Request("http://localhost:3000/api/xenon/_admin/action", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ type: "auth.setup", name: "Ada", email: "ada@example.com", password: "password123" }),
    }));
    expect(evilOrigin.status).toBe(403);

    // Non-JSON content-type is rejected.
    const badCt = await handler(new Request("http://localhost:3000/api/xenon/_admin/action", {
      method: "POST",
      headers: { "content-type": "text/plain", origin: "http://localhost:3000" },
      body: "{}",
    }));
    expect(badCt.status).toBe(415);

    // 3. Trusted Origin auth.setup creates the admin and sets the BetterAuth session cookie.
    const setupRes = await handler(new Request("http://localhost:3000/api/xenon/_admin/action", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://admin.example" },
      body: JSON.stringify({ type: "auth.setup", name: "Ada", email: "ada@example.com", password: "password123" }),
    }));
    expect(setupRes.status).toBe(200);
    expect(setupRes.headers.get("cache-control")).toBe("private, no-store");
    expect(await setupRes.json()).toEqual({ ok: true, data: null });
    const setCookies = setupRes.headers.getSetCookie();
    expect(setCookies.length).toBeGreaterThan(0);
    const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");
    expect(cookieHeader).toContain("session_token=");

    // 4. API key Bearer tokens are refused on /_admin/action and treated as unauthenticated on /_admin/data.
    const apiKeyAction = await handler(new Request("http://localhost:3000/api/xenon/_admin/action", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", authorization: "Bearer admin-key" },
      body: JSON.stringify({ type: "users.list" }),
    }));
    expect(apiKeyAction.status).toBe(403);

    const apiKeyData = await handler(new Request("http://localhost:3000/api/xenon/_admin/data?path=/admin", {
      headers: { authorization: "Bearer admin-key" },
    }));
    expect(await apiKeyData.json()).toEqual({ kind: "redirect", to: "/admin/login", status: 302 });

    // 5. Authenticated doc.save via /_admin/action works and /_admin/data matches shared loadAdminData identically.
    const saveRes = await handler(new Request("http://localhost:3000/api/xenon/_admin/action", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: cookieHeader },
      body: JSON.stringify({ type: "doc.save", collection: "posts", data: { title: "From HTTP Admin" }, draft: false }),
    }));
    expect(saveRes.status).toBe(200);
    const saved = (await saveRes.json()) as { ok: true; data: { id: string; data: { title: string } } };
    expect(saved.ok).toBe(true);
    expect(saved.data.data.title).toBe("From HTTP Admin");

    const httpHeaders = new Headers({ cookie: cookieHeader });
    const httpListRes = await handler(new Request("http://localhost:3000/api/xenon/_admin/data?path=/admin/collections/posts&q=HTTP", {
      headers: httpHeaders,
    }));
    expect(httpListRes.status).toBe(200);
    const httpPayload = (await httpListRes.json()) as Record<string, unknown>;
    const directPayload = await loadAdminData({
      config,
      xenon,
      segments: ["collections", "posts"],
      query: new URLSearchParams({ q: "HTTP" }),
      headers: httpHeaders,
    });
    expect(directPayload.kind).toBe("collection-list");
    if (directPayload.kind !== "collection-list") throw new Error("expected collection-list");
    // Strip rotating presenceToken exp/signature timestamp differences if ticked across ms; verify identical structure & data.
    expect({ ...httpPayload, shell: { ...(httpPayload.shell as object), presenceToken: "T" } }).toEqual({
      ...directPayload,
      shell: { ...directPayload.shell, presenceToken: "T" },
    });

    // Document edit route & 404 route.
    const editRes = await handler(new Request(`http://localhost:3000/api/xenon/_admin/data?path=/admin/collections/posts/${saved.data.id}`, {
      headers: httpHeaders,
    }));
    expect(editRes.status).toBe(200);
    expect(await editRes.json()).toMatchObject({ kind: "document-edit", doc: { id: saved.data.id } });

    const missingRes = await handler(new Request("http://localhost:3000/api/xenon/_admin/data?path=/admin/nope", {
      headers: httpHeaders,
    }));
    expect(missingRes.status).toBe(404);
    expect(await missingRes.json()).toMatchObject({ kind: "not-found" });

    // Invalid path traversal rejected with 400.
    const traversal = await handler(new Request("http://localhost:3000/api/xenon/_admin/data?path=/admin/../etc", {
      headers: httpHeaders,
    }));
    expect(traversal.status).toBe(400);

    // 6. Logout clears session and subsequent authenticated calls return 401.
    const logoutRes = await handler(new Request("http://localhost:3000/api/xenon/_admin/action", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: cookieHeader },
      body: JSON.stringify({ type: "auth.logout" }),
    }));
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.headers.getSetCookie().length).toBeGreaterThan(0);

    const afterLogout = await handler(new Request("http://localhost:3000/api/xenon/_admin/action", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: cookieHeader },
      body: JSON.stringify({ type: "users.list" }),
    }));
    expect(afterLogout.status).toBe(401);
  });
});
