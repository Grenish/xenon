import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryAdapter } from "../../src/adapters/memory";
import { XenonError } from "../../src/core/errors";
import { boolean, defineCollection, defineConfig, number, select, text } from "../../src/index";
import { createApiHandler } from "../../src/next/api-handler";
import { createXenon } from "../../src/server/xenon";
import { LocalStorageAdapter } from "../../src/storage/local";

const posts = defineCollection({ slug: "posts", slugFrom: "title", fields: {
  title: text({ required: true, maxLength: 200 }), count: number(), featured: boolean(),
  category: select({ options: ["news", "guide"], required: true, defaultValue: "news" }),
} });
const assets = defineCollection({ slug: "media", upload: { mimeTypes: ["text/*", "image/png"], maxFileSize: 1024 }, fields: {
  alt: text({ required: true }),
} });
const locked = defineCollection({ slug: "locked", fields: { title: text() }, access: {
  read: () => false, create: ({ user }) => user?.role === "admin", update: () => false, delete: () => false,
} });

function makeConfig(directory: string) {
  return defineConfig({
    collections: [posts, assets, locked], db: memoryAdapter(), storage: new LocalStorageAdapter({ directory }),
    auth: {
      secret: "rest-test-secret-abcdefghijklmnopqrstuvwxyz-0123456789", baseURL: "http://localhost:3000",
      trustedOrigins: ["https://trusted.example"],
      apiKeys: [{ key: "test-key", role: "editor" }, { key: "admin-key", role: "admin" }],
    },
  });
}

describe("REST handler with real Local API, auth, memory database and local files", () => {
  let directory: string;
  let config: ReturnType<typeof makeConfig>;
  let xenon: ReturnType<typeof createXenon<ReturnType<typeof makeConfig>>>;
  let handlers: ReturnType<typeof createApiHandler>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "xenon-rest-"));
    config = makeConfig(directory);
    xenon = createXenon(config);
    handlers = createApiHandler(config, { xenon });
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  function request(method: keyof typeof handlers, path: string, body?: unknown, token?: string, extraHeaders?: HeadersInit) {
    const headers = new Headers(extraHeaders);
    if (token) headers.set("authorization", `Bearer ${token}`);
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { payload = JSON.stringify(body); headers.set("content-type", "application/json"); }
    const url = new URL(`/api/xenon/${path}`, "http://localhost:3000");
    const slug = url.pathname.slice("/api/xenon/".length).split("/").filter(Boolean).map(decodeURIComponent);
    return handlers[method](new Request(url, { method, headers, body: payload }), { params: Promise.resolve({ slug }) });
  }

  async function create(title = "Hello", data: Record<string, unknown> = {}) {
    const response = await request("POST", "posts", { title, ...data }, "test-key");
    expect(response.status).toBe(201);
    return await response.json();
  }

  function uploadForm(contents = "hello file", type = "text/plain", name = "hello.txt") {
    const form = new FormData();
    form.set("data", JSON.stringify({ alt: "A document" }));
    form.set("file", new File([contents], name, { type }));
    return form;
  }

  test("API-key CRUD and public published reads return documents and pagination", async () => {
    const doc = await create();
    expect(doc).toMatchObject({ title: "Hello", slug: "hello", status: "published", category: "news" });
    const listed = await request("GET", "posts");
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({ docs: [{ id: doc.id }], totalDocs: 1, limit: 10, page: 1 });
    const read = await request("GET", `posts/${doc.id}`);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(doc);
    const updated = await request("PATCH", `posts/${doc.id}`, { title: "Changed" }, "test-key");
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ id: doc.id, title: "Changed", category: "news", slug: "hello" });
    const deleted = await request("DELETE", `posts/${doc.id}`, undefined, "test-key");
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ id: doc.id, title: "Changed" });
    expect((await request("GET", `posts/${doc.id}`)).status).toBe(404);
  });

  test("filtering coerces bracket values and combines sorting with pagination", async () => {
    await create("Two", { count: 2, featured: true });
    await create("Ten", { count: 10, featured: true });
    await create("Other", { count: 20, featured: false });
    const response = await request("GET", "posts?where[count][gte]=2&where[featured][equals]=true&sort=-count&limit=1&page=2");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ docs: [{ title: "Two" }], totalDocs: 2, totalPages: 2, hasPrevPage: true });
    const where = encodeURIComponent(JSON.stringify({ or: [{ count: { equals: "10" } }, { title: { contains: "OTHER" } }] }));
    expect(await (await request("GET", `posts?where=${where}&sort=title`)).json()).toMatchObject({ docs: [{ title: "Other" }, { title: "Ten" }], totalDocs: 2 });
    expect(await (await request("GET", "posts?limit=0")).json()).toMatchObject({ limit: 100 });
  });

  test("draft creation, patching, publishing and unpublishing preserve the live snapshot", async () => {
    const response = await request("POST", "posts?draft=true", {}, "test-key");
    expect(response.status).toBe(201);
    const draft = await response.json();
    expect(draft.status).toBe("draft");
    expect((await request("GET", `posts/${draft.id}`)).status).toBe(404);
    expect((await request("GET", `posts/${draft.id}?draft=true`)).status).toBe(401);
    expect((await request("GET", `posts/${draft.id}?draft=true`, undefined, "test-key")).status).toBe(200);
    expect((await request("PATCH", `posts/${draft.id}`, { title: "Published" }, "test-key")).status).toBe(200);
    expect((await request("PATCH", `posts/${draft.id}?draft=true`, { title: "Working" }, "test-key")).status).toBe(200);
    expect(await (await request("GET", `posts/${draft.id}`)).json()).toMatchObject({ title: "Published", status: "published" });
    expect(await (await request("GET", `posts/${draft.id}?draft=true`, undefined, "test-key")).json()).toMatchObject({ title: "Working" });
    const unpublished = await request("POST", `posts/${draft.id}/unpublish`, undefined, "test-key");
    expect(unpublished.status).toBe(200);
    expect(await unpublished.json()).toMatchObject({ status: "draft", title: "Working" });
    expect((await request("GET", `posts/${draft.id}`)).status).toBe(404);
  });

  test("anonymous/invalid-key writes are 401; custom denied access is 403 for logged-in users", async () => {
    expect((await request("POST", "posts", { title: "No" })).status).toBe(401);
    expect((await request("POST", "posts", { title: "No" }, "wrong-key")).status).toBe(401);
    expect((await request("GET", "posts?draft=true")).status).toBe(401);
    expect((await request("POST", "locked", { title: "No" }, "test-key")).status).toBe(403);
    expect((await request("GET", "locked", undefined, "test-key")).status).toBe(403);
    expect((await request("POST", "locked", { title: "Admin" }, "admin-key")).status).toBe(201);
    const doc = await create();
    expect((await request("PATCH", `posts/${doc.id}`, { title: "No" })).status).toBe(401);
    expect((await request("DELETE", `posts/${doc.id}`)).status).toBe(401);
    expect((await request("POST", `posts/${doc.id}/unpublish`)).status).toBe(401);
  });

  test("validation errors retain field paths and strict unknown-key issues", async () => {
    const response = await request("POST", "posts", { title: 123 }, "test-key");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errors: [{ path: ["title"] }] });
    const unknown = await request("POST", "posts", { title: "Hello", id: "forged" }, "test-key");
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ errors: [{ path: [] }] });
  });

  test("missing collection, document, and route shapes return 404", async () => {
    const id = crypto.randomUUID();
    for (const [method, path] of [
      ["GET", "missing"], ["GET", `posts/${id}`], ["PATCH", `posts/${id}`], ["DELETE", `posts/${id}`],
      ["POST", `posts/${id}`], ["GET", `posts/${id}/unpublish`], ["GET", `posts/${id}/extra/segments`],
      ["DELETE", "posts"], ["PATCH", "posts"], ["GET", "_files"],
    ] as const) expect((await request(method, path, method === "PATCH" ? {} : undefined, "test-key")).status).toBe(404);
  });

  test("malformed JSON, non-object data, and unsupported content types are client errors", async () => {
    const context = { params: Promise.resolve({ slug: ["posts"] }) };
    const headers = { authorization: "Bearer test-key", "content-type": "application/json" };
    expect((await handlers.POST(new Request("http://localhost:3000/api/xenon/posts", { method: "POST", headers, body: "{" }), context)).status).toBe(400);
    expect((await request("POST", "posts", [], "test-key")).status).toBe(400);
    expect((await request("POST", "posts", null, "test-key")).status).toBe(400);
    expect((await request("POST", "posts", undefined, "test-key", { "content-type": "text/plain" })).status).toBe(415);
    expect((await request("GET", "posts?limit=bad")).status).toBe(400);
  });

  test("multipart create/replace, file serving and deletion use local storage", async () => {
    const created = await request("POST", "media?draft=true", uploadForm(), "test-key");
    expect(created.status).toBe(201);
    const doc = await created.json();
    // Multipart decoders may attach a charset parameter to text/plain.
    expect(doc).toMatchObject({ filename: "hello.txt", mimeType: expect.stringContaining("text/plain"), filesize: 10, alt: "A document", status: "published" });
    const relative = doc.url.slice("/api/xenon/".length);
    const file = await request("GET", relative);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("text/plain");
    expect(file.headers.get("content-length")).toBe("10");
    expect(file.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    expect(file.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(file.headers.get("content-disposition")).toBe("attachment");
    expect(await file.text()).toBe("hello file");
    const replaced = await request("PATCH", `media/${doc.id}`, uploadForm("replaced file", "text/plain", "replacement.txt"), "test-key");
    expect(replaced.status).toBe(200);
    const replacement = await replaced.json();
    expect(replacement.filename).toBe("replacement.txt");
    expect((await request("GET", relative)).status).toBe(404);
    expect((await request("DELETE", `media/${doc.id}`, undefined, "test-key")).status).toBe(200);
    expect((await request("GET", replacement.url.slice("/api/xenon/".length))).status).toBe(404);
  });

  test("uploads map size and MIME policy errors to 413 and 415", async () => {
    expect((await request("POST", "media", uploadForm("x".repeat(1025)), "test-key")).status).toBe(413);
    expect((await request("POST", "media", uploadForm("pdf", "application/pdf", "file.pdf"), "test-key")).status).toBe(415);
    expect((await request("POST", "media", { alt: "No file" }, "test-key")).status).toBe(400);
    expect((await request("GET", "_files/missing.txt")).status).toBe(404);
  });

  test("multipart errors return 400; omitted data becomes an empty object", async () => {
    const form = uploadForm(); form.set("data", "not JSON");
    expect((await request("POST", "media", form, "test-key")).status).toBe(400);
    form.set("data", "[]");
    expect((await request("POST", "media", form, "test-key")).status).toBe(400);
    form.set("data", "{}"); form.set("file", "not a file");
    expect((await request("POST", "media", form, "test-key")).status).toBe(400);
    const draft = new FormData();
    expect((await request("POST", "posts?draft=true", draft, "test-key")).status).toBe(201);
  });

  test("auth routes delegate to BetterAuth and session cookies authorize later requests", async () => {
    const auth = (await xenon.getAuth())!;
    const createUser = auth.api.createUser as (args: { body: { email: string; password: string; name: string; role: "admin" } }) => Promise<unknown>;
    await createUser({ body: { email: "admin@example.test", password: "secret-password-123", name: "Admin", role: "admin" } });
    const login = await request("POST", "auth/sign-in/email", { email: "admin@example.test", password: "secret-password-123" });
    expect(login.status).toBe(200);
    const cookies = login.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
    expect(cookies).toContain("session_token");
    const write = await request("POST", "posts", { title: "Session post" }, undefined, { cookie: cookies, origin: "http://localhost:3000" });
    expect(write.status).toBe(201);
    const invalidBearer = await request("POST", "posts", { title: "No fallback" }, "wrong-key", { cookie: cookies });
    expect(invalidBearer.status).toBe(401);
    // Cookie writes require same-origin or explicitly trusted Origin; GETs need no Origin.
    for (const origin of [undefined, "https://evil.example", "null", "not a URL", "http://localhost:3000.evil.example"]) {
      const headers = new Headers({ cookie: cookies });
      if (origin !== undefined) headers.set("origin", origin);
      const blocked = await request("POST", "posts", { title: "Blocked" }, undefined, headers);
      expect(blocked.status).toBe(403);
      expect(await blocked.json()).toMatchObject({ errors: [{ message: "Cookie-authenticated writes require a trusted Origin header." }] });
    }
    expect((await request("POST", "posts", { title: "Trusted" }, undefined, { cookie: cookies, origin: "https://trusted.example" })).status).toBe(201);
    expect((await request("GET", "posts?draft=true", undefined, undefined, { cookie: cookies })).status).toBe(200);
    const id = (await write.json()).id;
    for (const [method, path, body] of [
      ["PATCH", `posts/${id}`, { title: "Cross-site edit" }],
      ["DELETE", `posts/${id}`, undefined],
      ["POST", `posts/${id}/unpublish`, undefined],
    ] as const) expect((await request(method, path, body, undefined, { cookie: cookies, origin: "https://evil.example" })).status).toBe(403);
    // Bearer auth is independent of browser cookies and may be used cross-origin.
    expect((await request("POST", "posts", { title: "Bearer" }, "test-key", { origin: "https://other.example" })).status).toBe(201);
    expect((await request("POST", "auth/sign-up/email", { email: "new@example.test", password: "secret-password-123", name: "New" })).status).not.toBe(200);
  });

  test.each([
    { type: "text/html", attachment: true }, { type: "application/xhtml+xml", attachment: true },
    { type: "image/svg+xml", attachment: true }, { type: "image/svg+xml; charset=utf-8", attachment: true },
    { type: "text/javascript", attachment: true }, { type: "application/octet-stream", attachment: true },
    { type: "image/png", attachment: false }, { type: "image/jpeg", attachment: false },
    { type: "video/mp4", attachment: false }, { type: "audio/mpeg", attachment: false },
    { type: "application/pdf", attachment: false },
  ])("file response isolates $type and preserves safe embedding", async ({ type, attachment }) => {
    const file = { body: new Uint8Array([1, 2]), contentType: type, size: 2 };
    const stub = spyOn(xenon, "readFile").mockResolvedValue(file);
    try {
      const response = await request("GET", "_files/immutable-file");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-disposition")).toBe(attachment ? "attachment" : null);
      expect(response.headers.get("content-type")).toBe(type);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(file.body);
    } finally { stub.mockRestore(); }
  });

  test("missing auth/storage capabilities return 404", async () => {
    const noDatabase = defineConfig({ collections: [posts] });
    const noDbHandlers = createApiHandler(noDatabase, { xenon: createXenon(noDatabase) });
    expect((await noDbHandlers.GET(new Request("http://localhost:3000/api/xenon/auth/ok"), { params: Promise.resolve({ slug: ["auth", "ok"] }) })).status).toBe(404);
    const noStorage = defineConfig({ collections: [posts], db: memoryAdapter(), auth: config.auth });
    const noStorageHandlers = createApiHandler(noStorage, { xenon: createXenon(noStorage) });
    expect((await noStorageHandlers.GET(new Request("http://localhost:3000/api/xenon/_files/file.txt"), { params: Promise.resolve({ slug: ["_files", "file.txt"] }) })).status).toBe(404);
  });

  test("operational errors retain their status; unexpected errors hide internal details", async () => {
    for (const [code, status] of [["BAD_REQUEST", 400], ["UNAUTHORIZED", 401], ["FORBIDDEN", 403], ["NOT_FOUND", 404], ["CONFLICT", 409], ["PAYLOAD_TOO_LARGE", 413], ["UNSUPPORTED_MEDIA_TYPE", 415]] as const) {
      const stub = spyOn(xenon, "find").mockRejectedValue(new XenonError(code, "Expected error"));
      try {
        const response = await request("GET", "posts");
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ errors: [{ message: "Expected error" }] });
      } finally { stub.mockRestore(); }
    }
    const stub = spyOn(xenon, "find").mockRejectedValue(new Error("private credentials"));
    try {
      const response = await request("GET", "posts");
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("private credentials");
    } finally { stub.mockRestore(); }
  });
});
