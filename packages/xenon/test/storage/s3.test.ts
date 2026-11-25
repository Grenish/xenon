import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { S3StorageAdapter } from "../../src/storage/s3";

const options = {
  endpoint: "https://account.r2.cloudflarestorage.com/", bucket: "media",
  accessKeyId: "test-key", secretAccessKey: "test-secret", publicUrl: "https://cdn.example/",
};

describe("S3StorageAdapter (signed requests, no network)", () => {
  let requests: Request[];
  let responseStatus: number;
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
  beforeEach(() => {
    requests = [];
    responseStatus = 204;
    const fakeFetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return new Response(null, { status: responseStatus });
    }, { preconnect: globalThis.fetch.preconnect });
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fakeFetch);
  });
  afterEach(() => { fetchSpy.mockRestore(); });

  test("signs path-style R2 uploads with auto region and content headers", async () => {
    const storage = new S3StorageAdapter(options);
    const key = "photos/a #?%.png";
    const body = new Uint8Array([1, 2, 3]);
    expect(await storage.upload({ key, body, contentType: "image/png", size: 3 })).toEqual({
      key, url: "https://cdn.example/photos/a%20%23%3F%25.png",
    });
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.method).toBe("PUT");
    expect(request.url).toBe("https://account.r2.cloudflarestorage.com/media/photos/a%20%23%3F%25.png");
    expect(request.headers.get("content-type")).toBe("image/png");
    expect(request.headers.get("content-length")).toBe("3");
    expect(request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=test-key\/\d{8}\/auto\/s3\/aws4_request/);
    expect(request.headers.get("x-amz-date")).toMatch(/^\d{8}T\d{6}Z$/);
    expect(new Uint8Array(await request.arrayBuffer())).toEqual(body);
    expect("read" in storage).toBe(false);
  });

  test("prefix applies to both signed object URLs and public URLs", async () => {
    const storage = new S3StorageAdapter({ ...options, prefix: "/site uploads/assets/", region: "us-east-1" });
    expect(storage.getUrl("a/b.jpg")).toBe("https://cdn.example/site%20uploads/assets/a/b.jpg");
    await storage.delete("a/b.jpg");
    expect(requests[0]!.url).toBe("https://account.r2.cloudflarestorage.com/media/site%20uploads/assets/a/b.jpg");
    expect(requests[0]!.method).toBe("DELETE");
    expect(requests[0]!.headers.get("authorization")).toContain("/us-east-1/s3/aws4_request");
  });

  test.each([200, 204, 404])("delete resolves for status %i", async (status) => {
    responseStatus = status;
    await new S3StorageAdapter(options).delete("missing.png");
    expect(requests).toHaveLength(1);
  });

  test.each([400, 403, 500])("failed requests include status %i", async (status) => {
    responseStatus = status;
    const storage = new S3StorageAdapter(options);
    await expect(storage.upload({ key: "file.txt", body: new Uint8Array(), size: 0, contentType: "text/plain" })).rejects.toThrow(String(status));
    await expect(storage.delete("file.txt")).rejects.toThrow(String(status));
  });

  test("upload 404 is a failure", async () => {
    responseStatus = 404;
    await expect(new S3StorageAdapter(options).upload({
      key: "file.txt", body: new Uint8Array(), size: 0, contentType: "text/plain",
    })).rejects.toThrow("404");
  });

  test("createPresignedUpload signs SigV4 query PUT URL with content-type and content-length without network I/O", async () => {
    const storage = new S3StorageAdapter({ ...options, prefix: "/site uploads/" });
    const result = await storage.createPresignedUpload({
      key: "media/a #?%.png",
      contentType: "image/png",
      size: 4096,
      expiresIn: 300,
    });
    expect(requests).toHaveLength(0);
    expect(result.key).toBe("media/a #?%.png");
    expect(result.method).toBe("PUT");
    expect(result.headers).toEqual({ "content-type": "image/png" });
    expect(Number.isFinite(Date.parse(result.expiresAt))).toBe(true);

    const parsed = new URL(result.url);
    expect(parsed.origin).toBe("https://account.r2.cloudflarestorage.com");
    expect(parsed.pathname).toBe("/media/site%20uploads/media/a%20%23%3F%25.png");
    expect(parsed.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(parsed.searchParams.get("X-Amz-Credential")).toMatch(/^test-key\/\d{8}\/auto\/s3\/aws4_request$/);
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(parsed.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  test("createPresignedUpload omits content-length from signed headers when size is omitted and clamps expiresIn", async () => {
    const storage = new S3StorageAdapter(options);
    const result = await storage.createPresignedUpload({
      key: "media/photo.png",
      contentType: "image/png",
      expiresIn: 999_999,
    });
    const parsed = new URL(result.url);
    expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("604800");

    await expect(storage.createPresignedUpload({ key: "../escape.png", contentType: "image/png" })).rejects.toThrow("Unsafe storage key");
    await expect(storage.createPresignedUpload({ key: "media/a.png", contentType: "image/png", expiresIn: 0 })).rejects.toThrow(RangeError);
    await expect(storage.createPresignedUpload({ key: "media/a.png", contentType: "image/png", size: -1 })).rejects.toThrow(RangeError);
  });

  test("head signs HEAD request, parses metadata, returns null on 404, and throws on invalid length or errors", async () => {
    fetchSpy.mockRestore();
    let mode: "ok" | "404" | "missing-len" | "500" = "ok";
    const fakeFetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      if (mode === "404") return new Response(null, { status: 404 });
      if (mode === "500") return new Response(null, { status: 500 });
      if (mode === "missing-len") return new Response(null, { status: 200 });
      return new Response(null, {
        status: 200,
        headers: { "content-length": "2048", "content-type": "image/png", etag: '"abc"' },
      });
    }, { preconnect: globalThis.fetch.preconnect });
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fakeFetch);

    const storage = new S3StorageAdapter(options);
    expect(await storage.head("media/a.png")).toEqual({ size: 2048, contentType: "image/png", etag: '"abc"' });
    expect(requests[0]!.method).toBe("HEAD");
    expect(requests[0]!.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);

    mode = "404";
    expect(await storage.head("media/missing.png")).toBeNull();

    mode = "missing-len";
    await expect(storage.head("media/bad.png")).rejects.toThrow("content-length");

    mode = "500";
    await expect(storage.head("media/err.png")).rejects.toThrow("500");
  });

  test("readRange sends Range header, handles 206/404/416, and caps oversized 200 streams", async () => {
    fetchSpy.mockRestore();
    let mode: "206" | "404" | "416" | "oversized-200" | "403" = "206";
    let cancelled = false;
    const fakeFetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      if (mode === "404") return new Response(null, { status: 404 });
      if (mode === "416") return new Response(null, { status: 416 });
      if (mode === "403") return new Response(null, { status: 403 });
      if (mode === "oversized-200") {
        let pulls = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls++;
            if (pulls > 10) { controller.close(); return; }
            controller.enqueue(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
          },
          cancel() { cancelled = true; },
        });
        return new Response(stream, { status: 200 });
      }
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 206 });
    }, { preconnect: globalThis.fetch.preconnect });
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fakeFetch);

    const storage = new S3StorageAdapter(options);
    const bytes = await storage.readRange("media/a.png", 0, 3);
    expect(bytes).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(requests[0]!.method).toBe("GET");
    expect(requests[0]!.headers.get("range")).toBe("bytes=0-3");

    mode = "404";
    expect(await storage.readRange("media/missing.png", 0, 63)).toBeNull();

    mode = "416";
    expect(await storage.readRange("media/empty.txt", 0, 63)).toEqual(new Uint8Array(0));

    mode = "oversized-200";
    const capped = await storage.readRange("media/huge.bin", 0, 9);
    expect(capped?.byteLength).toBe(10);
    expect(cancelled).toBe(true);

    mode = "403";
    await expect(storage.readRange("media/denied.png", 0, 63)).rejects.toThrow("403");
    await expect(storage.readRange("media/a.png", -1, 10)).rejects.toThrow(RangeError);
    await expect(storage.readRange("media/a.png", 10, 5)).rejects.toThrow(RangeError);
  });

  test("readRange does not deadlock when fetch returns a tee'd stream (Next.js patch-fetch regression)", async () => {
    fetchSpy.mockRestore();
    let mode: "bounded-206" | "oversized-tee" = "bounded-206";
    let aborted = false;
    const fakeFetch = Object.assign(async (_input: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.addEventListener("abort", () => { aborted = true; });
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(mode === "bounded-206" ? [1, 2, 3, 4] : new Array(32).fill(7)));
          if (mode === "bounded-206") controller.close();
        },
      });
      // Leave sibling branch unconsumed (mirrors Next.js cloneResponse tee where cancel() blocks on the sibling).
      const [_unconsumed, branch] = source.tee();
      void _unconsumed;
      return new Response(branch, {
        status: mode === "bounded-206" ? 206 : 200,
        headers: mode === "bounded-206" ? { "content-length": "4" } : undefined,
      });
    }, { preconnect: globalThis.fetch.preconnect });
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fakeFetch);

    const storage = new S3StorageAdapter(options);
    expect(await storage.readRange("media/a.png", 0, 3)).toEqual(new Uint8Array([1, 2, 3, 4]));

    mode = "oversized-tee";
    const capped = await storage.readRange("media/big.bin", 0, 9);
    expect(capped?.byteLength).toBe(10);
    expect(aborted).toBe(true);
  });
});
