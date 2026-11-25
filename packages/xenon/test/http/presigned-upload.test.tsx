import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { memoryAdapter } from "../../src/adapters/memory";
import type { StorageAdapter } from "../../src/adapters/types";
import { loadAdminData } from "../../src/http/admin-loader";
import { createHandler } from "../../src/http/handler";
import { defineCollection, defineConfig, text } from "../../src/index";
import { signPresignToken } from "../../src/server/uploads";
import { createXenon } from "../../src/server/xenon";
import { LocalStorageAdapter } from "../../src/storage/local";
import { S3StorageAdapter } from "../../src/storage/s3";
import { AdminRuntimeProvider, useServices } from "../../src/ui/admin/runtime";
import { AdminRouterProvider, createHistoryRouter } from "../../src/ui/client";
import type { AdminServices } from "../../src/ui/shared/services";

const SECRET = "presigned-http-test-secret-0123456789abcdef";
const S3_ENDPOINT = "https://account.r2.cloudflarestorage.com";
const S3_PUBLIC = "https://cdn.example";
const S3_BUCKET = "assets";

const media = defineCollection({
  slug: "media",
  upload: { mimeTypes: ["image/png", "image/jpeg", "text/plain"], maxFileSize: 4096 },
  fields: { alt: text({ required: true }) },
});
const openMedia = defineCollection({
  slug: "open-media",
  upload: { maxFileSize: 4096 },
  fields: { caption: text() },
});
const restrictedMedia = defineCollection({
  slug: "restricted-media",
  upload: true,
  fields: { alt: text() },
  access: {
    create: ({ user }) => user?.role === "admin",
    update: ({ user }) => user?.role === "admin",
  },
});
const posts = defineCollection({
  slug: "posts",
  fields: { title: text({ required: true }) },
});

function makePng(width: number, height: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(new ArrayBuffer(24));
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buf.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(buf.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return buf;
}

const PNG_640x480 = makePng(640, 480);
const PNG_800x600 = makePng(800, 600);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const HTML_BYTES = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
const SVG_BYTES = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

interface StoredObject {
  body: Uint8Array<ArrayBuffer>;
  contentType: string | null;
}

/** In-memory S3/R2 HTTP emulator backing real `S3StorageAdapter` calls via mocked `fetch`. */
function createMockS3Fetch(objects: Map<string, StoredObject>, log: { method: string; url: string; range?: string | null; contentType?: string | null }[]) {
  return Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.origin !== S3_ENDPOINT) {
      throw new Error(`Unexpected network request to ${req.url}`);
    }
    const prefix = `/${S3_BUCKET}/`;
    if (!url.pathname.startsWith(prefix)) return new Response(null, { status: 404 });
    const key = url.pathname.slice(prefix.length).split("/").map(decodeURIComponent).join("/");
    log.push({
      method: req.method,
      url: req.url,
      range: req.headers.get("range"),
      contentType: req.headers.get("content-type"),
    });

    if (req.method === "PUT") {
      // Simulate real S3/R2 SigV4 query validation for signed headers.
      if (url.searchParams.has("X-Amz-Signature")) {
        const signed = (url.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";");
        if (signed.includes("content-type") && !req.headers.get("content-type")) {
          return new Response("Missing content-type", { status: 403 });
        }
      }
      const body = new Uint8Array(await req.arrayBuffer());
      objects.set(key, { body, contentType: req.headers.get("content-type") });
      return new Response(null, { status: 200, headers: { etag: `"${body.byteLength}"` } });
    }
    if (req.method === "HEAD") {
      const obj = objects.get(key);
      if (!obj) return new Response(null, { status: 404 });
      const headers = new Headers({ "content-length": String(obj.body.byteLength), etag: `"${obj.body.byteLength}"` });
      if (obj.contentType) headers.set("content-type", obj.contentType);
      return new Response(null, { status: 200, headers });
    }
    if (req.method === "GET") {
      const obj = objects.get(key);
      if (!obj) return new Response(null, { status: 404 });
      const range = req.headers.get("range");
      if (range) {
        if (obj.body.byteLength === 0) return new Response(null, { status: 416 });
        const match = range.match(/^bytes=(\d+)-(\d+)$/);
        if (!match) return new Response(null, { status: 416 });
        const start = Number(match[1]);
        const end = Math.min(Number(match[2]), obj.body.byteLength - 1);
        const slice = obj.body.slice(start, end + 1);
        return new Response(slice, {
          status: 206,
          headers: { "content-length": String(slice.byteLength), "content-range": `bytes ${start}-${end}/${obj.body.byteLength}` },
        });
      }
      return new Response(obj.body.slice(), { status: 200, headers: { "content-length": String(obj.body.byteLength) } });
    }
    if (req.method === "DELETE") {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  }, { preconnect: globalThis.fetch.preconnect });
}

function makeConfig(storage: StorageAdapter) {
  return defineConfig({
    collections: [media, openMedia, restrictedMedia, posts],
    db: memoryAdapter(),
    storage,
    auth: {
      secret: SECRET,
      baseURL: "http://localhost:3000",
      apiKeys: [
        { key: "editor-key", role: "editor", name: "editor" },
        { key: "admin-key", role: "admin", name: "admin" },
      ],
    },
  });
}

describe("Presigned direct-to-S3/R2 uploads (_presign -> PUT -> _complete)", () => {
  let objects: Map<string, StoredObject>;
  let s3Log: { method: string; url: string; range?: string | null; contentType?: string | null }[];
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
  let config: ReturnType<typeof makeConfig>;
  let xenon: ReturnType<typeof createXenon<ReturnType<typeof makeConfig>>>;
  let handle: ReturnType<typeof createHandler>;

  beforeEach(() => {
    objects = new Map();
    s3Log = [];
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(createMockS3Fetch(objects, s3Log));
    const storage = new S3StorageAdapter({
      bucket: S3_BUCKET,
      endpoint: S3_ENDPOINT,
      accessKeyId: "test-access",
      secretAccessKey: "test-secret",
      publicUrl: S3_PUBLIC,
    });
    config = makeConfig(storage);
    xenon = createXenon(config);
    handle = createHandler(config, { xenon });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function api(method: string, path: string, body?: unknown, token?: string, extraHeaders?: HeadersInit) {
    const headers = new Headers(extraHeaders);
    if (token) headers.set("authorization", `Bearer ${token}`);
    let payload: BodyInit | undefined;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers.set("content-type", "application/json");
    }
    return handle(new Request(`http://localhost:3000/api/xenon/${path}`, { method, headers, body: payload }));
  }

  test("full two-step create flow: _presign -> direct S3 PUT -> _complete extracts dimensions and persists document", async () => {
    const presignRes = await api(
      "POST",
      "media/_presign",
      { filename: "Hero Image.png", mimeType: "image/png", size: PNG_640x480.byteLength },
      "editor-key",
    );
    expect(presignRes.status).toBe(200);
    expect(presignRes.headers.get("cache-control")).toBe("private, no-store");
    const presign = (await presignRes.json()) as {
      key: string;
      token: string;
      upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string };
      url: string;
    };
    expect(presign.key).toMatch(/^media\/\d{4}\/\d{2}\/[0-9a-f]{10}-hero-image\.png$/);
    expect(presign.url).toBe(`${S3_PUBLIC}/${presign.key}`);
    expect(presign.upload.method).toBe("PUT");
    expect(presign.upload.headers).toEqual({ "content-type": "image/png" });
    expect(s3Log).toHaveLength(0); // Presigning touches zero network.

    // Client PUTs directly to the presigned S3/R2 URL.
    const putRes = await fetch(presign.upload.url, {
      method: presign.upload.method,
      headers: presign.upload.headers,
      body: PNG_640x480,
    });
    expect(putRes.status).toBe(200);
    expect(objects.has(presign.key)).toBe(true);

    // Client calls _complete -> HEAD + Range GET + DB create.
    const completeRes = await api(
      "POST",
      "media/_complete",
      { token: presign.token, key: presign.key, data: { alt: "Hero banner" } },
      "editor-key",
    );
    expect(completeRes.status).toBe(201);
    expect(completeRes.headers.get("cache-control")).toBe("private, no-store");
    const doc = (await completeRes.json()) as Record<string, unknown>;
    expect(doc).toMatchObject({
      alt: "Hero banner",
      filename: "hero-image.png",
      mimeType: "image/png",
      filesize: PNG_640x480.byteLength,
      width: 640,
      height: 480,
      url: presign.url,
      status: "published",
    });

    // Verify S3 calls were PUT, HEAD, and bounded Range GET.
    expect(s3Log.map((e) => e.method)).toEqual(["PUT", "HEAD", "GET"]);
    expect(s3Log[2]!.range).toBe(`bytes=0-${PNG_640x480.byteLength - 1}`);

    // Document is readable via REST GET.
    const readRes = await api("GET", `media/${doc.id}`);
    expect(readRes.status).toBe(200);
    expect(await readRes.json()).toEqual(doc);
  });

  test("replace flow with id + If-Match deletes previous S3 object and rejects stale versions cleanly", async () => {
    // 1. Create initial image.
    const p1 = await (await api("POST", "media/_presign", { filename: "v1.png", mimeType: "image/png", size: PNG_640x480.byteLength }, "editor-key")).json();
    await fetch(p1.upload.url, { method: p1.upload.method, headers: p1.upload.headers, body: PNG_640x480 });
    const created = await (await api("POST", "media/_complete", { token: p1.token, data: { alt: "V1" } }, "editor-key")).json();

    // 2. Stale If-Match fails fast at _presign (409 CONFLICT with updatedAt issue).
    const stalePresign = await api(
      "POST",
      "media/_presign",
      { filename: "v2.png", mimeType: "image/png", size: PNG_800x600.byteLength, id: created.id },
      "editor-key",
      { "if-match": '"2000-01-01T00:00:00.000Z"' },
    );
    expect(stalePresign.status).toBe(409);
    expect(await stalePresign.json()).toMatchObject({ errors: [{ path: ["updatedAt"] }] });

    // 3. Mint replacement presign with current updatedAt.
    const p2 = await (await api(
      "POST",
      "media/_presign",
      { filename: "v2.png", mimeType: "image/png", size: PNG_800x600.byteLength, id: created.id },
      "editor-key",
      { "if-match": `"${created.updatedAt}"` },
    )).json();
    await fetch(p2.upload.url, { method: p2.upload.method, headers: p2.upload.headers, body: PNG_800x600 });

    // 4. Simulate concurrent edit before _complete -> 409 deletes new orphan and keeps old file!
    const concurrent = await (await api("PATCH", `media/${created.id}`, { alt: "Concurrent" }, "editor-key")).json();
    const staleComplete = await api(
      "POST",
      "media/_complete",
      { token: p2.token, id: created.id, data: { alt: "V2" } },
      "editor-key",
      { "if-match": `"${created.updatedAt}"` },
    );
    expect(staleComplete.status).toBe(409);
    expect(objects.has(p2.key)).toBe(false);
    expect(objects.has(p1.key)).toBe(true);

    // 5. Retry replacement with latest updatedAt -> 200 OK, old file deleted, new file kept.
    const p3 = await (await api(
      "POST",
      "media/_presign",
      { filename: "v3.png", mimeType: "image/png", size: PNG_800x600.byteLength, id: created.id },
      "editor-key",
      { "if-match": `"${concurrent.updatedAt}"` },
    )).json();
    await fetch(p3.upload.url, { method: p3.upload.method, headers: p3.upload.headers, body: PNG_800x600 });
    const replacedRes = await api(
      "POST",
      "media/_complete",
      { token: p3.token, id: created.id, data: { alt: "V3" } },
      "editor-key",
      { "if-match": `"${concurrent.updatedAt}"` },
    );
    expect(replacedRes.status).toBe(200);
    const replaced = await replacedRes.json();
    expect(replaced).toMatchObject({ id: created.id, alt: "V3", filename: "v3.png", width: 800, height: 600, url: p3.url });
    expect(objects.has(p1.key)).toBe(false);
    expect(objects.has(p3.key)).toBe(true);
  });

  test("Critical #2 guardrail deletes disguised HTML/SVG, mismatched magic bytes, oversized objects, and active HEAD content-types", async () => {
    // 1. Disguised HTML uploaded under presigned image/png -> 415 & object deleted.
    const pHtml = await (await api("POST", "media/_presign", { filename: "pic.png", mimeType: "image/png", size: HTML_BYTES.byteLength }, "editor-key")).json();
    await fetch(pHtml.upload.url, { method: "PUT", headers: pHtml.upload.headers, body: HTML_BYTES });
    const htmlComplete = await api("POST", "media/_complete", { token: pHtml.token, data: { alt: "Evil" } }, "editor-key");
    expect(htmlComplete.status).toBe(415);
    expect(objects.has(pHtml.key)).toBe(false);

    // 2. Disguised SVG uploaded under presigned image/png -> 415 & object deleted.
    const pSvg = await (await api("POST", "media/_presign", { filename: "icon.png", mimeType: "image/png", size: SVG_BYTES.byteLength }, "editor-key")).json();
    await fetch(pSvg.upload.url, { method: "PUT", headers: pSvg.upload.headers, body: SVG_BYTES });
    const svgComplete = await api("POST", "media/_complete", { token: pSvg.token, data: { alt: "Evil SVG" } }, "editor-key");
    expect(svgComplete.status).toBe(415);
    expect(objects.has(pSvg.key)).toBe(false);

    // 3. JPEG bytes uploaded under presigned image/png -> 415 & object deleted.
    const pJpg = await (await api("POST", "media/_presign", { filename: "mismatch.png", mimeType: "image/png", size: JPEG_BYTES.byteLength }, "editor-key")).json();
    await fetch(pJpg.upload.url, { method: "PUT", headers: pJpg.upload.headers, body: JPEG_BYTES });
    const jpgComplete = await api("POST", "media/_complete", { token: pJpg.token, data: { alt: "Wrong bytes" } }, "editor-key");
    expect(jpgComplete.status).toBe(415);
    expect(objects.has(pJpg.key)).toBe(false);

    // 4. Oversized object (> maxFileSize 4096) put directly into bucket -> HEAD catches 413 & deletes without Range GET.
    const pBig = await (await api("POST", "media/_presign", { filename: "sneaky.png", mimeType: "image/png", size: 24 }, "editor-key")).json();
    objects.set(pBig.key, { body: new Uint8Array(5000), contentType: "image/png" });
    const beforeGetCount = s3Log.filter((e) => e.method === "GET").length;
    const bigComplete = await api("POST", "media/_complete", { token: pBig.token, data: { alt: "Too big" } }, "editor-key");
    expect(bigComplete.status).toBe(413);
    expect(objects.has(pBig.key)).toBe(false);
    expect(s3Log.filter((e) => e.method === "GET").length).toBe(beforeGetCount);

    // 5. Storage reports active Content-Type on HEAD -> 415 & deleted.
    const pActiveHead = await (await api("POST", "open-media/_presign", { filename: "readme.txt", mimeType: "text/plain", size: 5 }, "editor-key")).json();
    objects.set(pActiveHead.key, { body: new TextEncoder().encode("hello"), contentType: "text/html" });
    const activeHeadComplete = await api("POST", "open-media/_complete", { token: pActiveHead.token }, "editor-key");
    expect(activeHeadComplete.status).toBe(415);
    expect(objects.has(pActiveHead.key)).toBe(false);

    // Zero media documents were persisted from any rejected upload.
    const list = await (await api("GET", "media")).json();
    expect(list.totalDocs).toBe(0);
  });

  test("replay protection returns 409 without deleting live object; validation errors clean up orphan", async () => {
    // Missing required `alt` on _complete -> 400 with field path & S3 object cleaned up.
    const pInvalid = await (await api("POST", "media/_presign", { filename: "no-alt.png", mimeType: "image/png", size: PNG_640x480.byteLength }, "editor-key")).json();
    await fetch(pInvalid.upload.url, { method: "PUT", headers: pInvalid.upload.headers, body: PNG_640x480 });
    const invalidRes = await api("POST", "media/_complete", { token: pInvalid.token, data: {} }, "editor-key");
    expect(invalidRes.status).toBe(400);
    expect(await invalidRes.json()).toMatchObject({ errors: [{ path: ["alt"] }] });
    expect(objects.has(pInvalid.key)).toBe(false);

    // Valid completion followed by replay -> 409, live S3 object stays intact!
    const pValid = await (await api("POST", "media/_presign", { filename: "once.png", mimeType: "image/png", size: PNG_640x480.byteLength }, "editor-key")).json();
    await fetch(pValid.upload.url, { method: "PUT", headers: pValid.upload.headers, body: PNG_640x480 });
    expect((await api("POST", "media/_complete", { token: pValid.token, data: { alt: "Once" } }, "editor-key")).status).toBe(201);
    const replay = await api("POST", "media/_complete", { token: pValid.token, data: { alt: "Twice" } }, "editor-key");
    expect(replay.status).toBe(409);
    expect(objects.has(pValid.key)).toBe(true);
  });

  test("token binding, expiry, auth, access control, CSRF origin guard, and unsupported routes", async () => {
    // Missing object on S3 -> 400
    const pMissing = await (await api("POST", "media/_presign", { filename: "never-put.png", mimeType: "image/png", size: 24 }, "editor-key")).json();
    expect((await api("POST", "media/_complete", { token: pMissing.token, data: { alt: "Missing" } }, "editor-key")).status).toBe(400);

    // Wrong user cannot complete another user's token -> 403
    await fetch(pMissing.upload.url, { method: "PUT", headers: pMissing.upload.headers, body: PNG_640x480 });
    expect((await api("POST", "media/_complete", { token: pMissing.token, data: { alt: "Stolen" } }, "admin-key")).status).toBe(403);
    // Wrong collection -> 400
    expect((await api("POST", "open-media/_complete", { token: pMissing.token, data: {} }, "editor-key")).status).toBe(400);
    // Wrong key -> 400
    expect((await api("POST", "media/_complete", { token: pMissing.token, key: "media/2026/11/other.png", data: { alt: "Wrong key" } }, "editor-key")).status).toBe(400);
    // Tampered token -> 400
    expect((await api("POST", "media/_complete", { token: `${pMissing.token}tamper`, data: { alt: "Tampered" } }, "editor-key")).status).toBe(400);
    // Expired token -> 400
    const expired = await signPresignToken(SECRET, {
      collection: "media",
      key: pMissing.key,
      filename: "never-put.png",
      mimeType: "image/png",
      size: 24,
      userId: "apikey:editor",
      exp: Date.now() - 1000,
    });
    expect((await api("POST", "media/_complete", { token: expired, data: { alt: "Expired" } }, "editor-key")).status).toBe(400);

    // Auth & access control
    const anonPresign = await api("POST", "media/_presign", { filename: "a.png", mimeType: "image/png", size: 24 });
    expect(anonPresign.status).toBe(401);
    expect(anonPresign.headers.get("cache-control")).toBe("private, no-store");
    expect((await api("POST", "restricted-media/_presign", { filename: "a.png", mimeType: "image/png", size: 24 }, "editor-key")).status).toBe(403);
    expect((await api("POST", "restricted-media/_presign", { filename: "a.png", mimeType: "image/png", size: 24 }, "admin-key")).status).toBe(200);

    // Non-upload collection -> 400
    expect((await api("POST", "posts/_presign", { filename: "a.png", mimeType: "image/png", size: 24 }, "editor-key")).status).toBe(400);
    expect((await api("POST", "posts/_complete", { token: pMissing.token, data: {} }, "editor-key")).status).toBe(400);

    // Non-POST methods on _presign / _complete -> 404
    expect((await api("GET", "media/_presign", undefined, "editor-key")).status).toBe(404);
    expect((await api("DELETE", "media/_complete", undefined, "editor-key")).status).toBe(404);

    // Non-JSON body -> 415
    const nonJson = await handle(new Request("http://localhost:3000/api/xenon/media/_presign", {
      method: "POST",
      headers: { authorization: "Bearer editor-key", "content-type": "text/plain" },
      body: "hi",
    }));
    expect(nonJson.status).toBe(415);

    // Cookie-authenticated user without trusted Origin -> 403 (High #5 CSRF guardrail)
    const auth = (await xenon.getAuth())!;
    await (auth.api as Record<string, (arg: unknown) => Promise<unknown>>).createUser!({
      body: { email: "ada@example.com", password: "password123", name: "Ada", role: "admin" },
    });
    const loginRes = await handle(new Request("http://localhost:3000/api/xenon/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email: "ada@example.com", password: "password123" }),
    }));
    const cookie = loginRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const badOrigin = await api(
      "POST",
      "media/_presign",
      { filename: "csrf.png", mimeType: "image/png", size: 24 },
      undefined,
      { cookie, origin: "https://evil.example" },
    );
    expect(badOrigin.status).toBe(403);
    const goodOrigin = await api(
      "POST",
      "media/_presign",
      { filename: "csrf.png", mimeType: "image/png", size: 24 },
      undefined,
      { cookie, origin: "http://localhost:3000" },
    );
    expect(goodOrigin.status).toBe(200);

    // loadAdminData exposes presignedUploads=true when signed in, false when unauthenticated
    const unauthAdmin = await loadAdminData({ config, xenon, segments: ["login"], headers: new Headers() });
    expect(unauthAdmin.kind).toBe("auth");
    if (unauthAdmin.kind === "auth") expect(unauthAdmin.shell.presignedUploads).toBe(false);
    const authAdmin = await loadAdminData({ config, xenon, segments: [], headers: new Headers({ cookie }) });
    expect(authAdmin.kind).toBe("dashboard");
    if (authAdmin.kind === "dashboard") expect(authAdmin.shell.presignedUploads).toBe(true);
  });

  test("LocalStorageAdapter returns 501 NOT_IMPLEMENTED for _presign and _complete and presignedUploads=false in admin", async () => {
    const localConfig = makeConfig(new LocalStorageAdapter());
    const localXenon = createXenon(localConfig);
    const localHandle = createHandler(localConfig, { xenon: localXenon });

    expect(localXenon.supportsPresignedUploads).toBe(false);
    const res = await localHandle(new Request("http://localhost:3000/api/xenon/media/_presign", {
      method: "POST",
      headers: { authorization: "Bearer editor-key", "content-type": "application/json" },
      body: JSON.stringify({ filename: "a.png", mimeType: "image/png", size: 24 }),
    }));
    expect(res.status).toBe(501);
    const completeRes = await localHandle(new Request("http://localhost:3000/api/xenon/media/_complete", {
      method: "POST",
      headers: { authorization: "Bearer editor-key", "content-type": "application/json" },
      body: JSON.stringify({ token: "any", data: {} }),
    }));
    expect(completeRes.status).toBe(501);
  });

  test("admin client useServices().upload uses _presign -> PUT -> _complete when presignedUploads=true, multipart when false", async () => {
    fetchSpy.mockRestore();
    const clientCalls: { method: string; url: string; credentials?: RequestCredentials; ifMatch?: string | null; isFormData: boolean }[] = [];
    const s3Fetch = createMockS3Fetch(objects, s3Log);

    const routedFetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const isFormData = init?.body instanceof FormData;
      const headers = new Headers(init?.headers);
      clientCalls.push({
        method: init?.method ?? (input instanceof Request ? input.method : "GET"),
        url: urlStr,
        credentials: init?.credentials,
        ifMatch: headers.get("if-match"),
        isFormData,
      });
      if (urlStr.startsWith("/api/xenon/")) {
        headers.set("authorization", "Bearer editor-key");
        return handle(new Request(`http://localhost:3000${urlStr}`, {
          method: init?.method ?? "GET",
          headers,
          body: init?.body,
        }));
      }
      return s3Fetch(input, init);
    }, { preconnect: globalThis.fetch.preconnect });
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(routedFetch);

    function captureServices(presignedUploads: boolean): { services: AdminServices; refreshed: () => number } {
      let services!: AdminServices;
      let refreshes = 0;
      const router = createHistoryRouter({ onRefresh: () => { refreshes++; } });
      function Probe() {
        services = useServices();
        return null;
      }
      renderToStaticMarkup(
        <AdminRouterProvider router={router}>
          <AdminRuntimeProvider
            basePath="/admin"
            apiPath="/api/xenon"
            theme="light"
            presignedUploads={presignedUploads}
            action={async (actionInput) => {
              if (actionInput.type === "doc.get") {
                const doc = await xenon.findById({ collection: actionInput.collection as "media", id: actionInput.id });
                if (!doc) return { ok: false, error: { code: "NOT_FOUND", message: "Not found" } };
                const { id, slug, status, createdAt, updatedAt, ...data } = doc;
                return { ok: true, data: { id, slug, status, createdAt, updatedAt, hasUnpublishedChanges: false, data } };
              }
              return { ok: false, error: { code: "BAD_REQUEST", message: "Unsupported" } };
            }}
          >
            <Probe />
          </AdminRuntimeProvider>
        </AdminRouterProvider>,
      );
      return { services, refreshed: () => refreshes };
    }

    // 1. presignedUploads=true: _presign -> PUT (credentials: "omit") -> _complete -> doc.get + refresh.
    const { services: presignedServices, refreshed } = captureServices(true);
    const file = new File([PNG_640x480], "client-hero.png", { type: "image/png" });
    const created = await presignedServices.upload({ collection: "media", file, data: { alt: "Client Hero" } });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.data.data).toMatchObject({ alt: "Client Hero", filename: "client-hero.png", width: 640, height: 480 });
    }
    expect(refreshed()).toBe(1);
    const browserSteps = clientCalls.filter((c) => c.url.startsWith("/api/xenon/") || c.method === "PUT");
    expect(browserSteps.map((c) => `${c.method} ${c.url.startsWith(S3_ENDPOINT) ? "S3" : c.url}`)).toEqual([
      "POST /api/xenon/media/_presign",
      "PUT S3",
      "POST /api/xenon/media/_complete",
    ]);
    expect(browserSteps[1]!.credentials).toBe("omit");

    // 2. presignedUploads=true replace forwards If-Match to both _presign and _complete.
    if (created.ok) {
      clientCalls.length = 0;
      const replacement = new File([PNG_800x600], "client-v2.png", { type: "image/png" });
      const updated = await presignedServices.upload({
        collection: "media",
        id: created.data.id,
        file: replacement,
        data: { alt: "Client V2" },
        expectedUpdatedAt: created.data.updatedAt,
      });
      expect(updated.ok).toBe(true);
      const steps = clientCalls.filter((c) => c.url.startsWith("/api/xenon/"));
      expect(steps[0]!.ifMatch).toBe(`"${created.data.updatedAt}"`);
      expect(steps[1]!.ifMatch).toBe(`"${created.data.updatedAt}"`);
    }

    // 3. presignedUploads=false: uses multipart POST directly (no _presign call).
    clientCalls.length = 0;
    const { services: multipartServices } = captureServices(false);
    const mpResult = await multipartServices.upload({ collection: "media", file, data: { alt: "Multipart" } });
    expect(mpResult.ok).toBe(true);
    expect(clientCalls[0]!.url).toBe("/api/xenon/media");
    expect(clientCalls[0]!.isFormData).toBe(true);
    expect(clientCalls.some((c) => c.url.includes("_presign"))).toBe(false);
  });
});
