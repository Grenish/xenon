import { describe, expect, test } from "bun:test";
import type { StorageAdapter } from "../../src/adapters/types";
import { XenonError, type XenonErrorCode } from "../../src/core/errors";
import type { AnyCollection, UploadOptions } from "../../src/core/types";
import {
  PRESIGN_SNIFF_BYTES,
  prepareUpload,
  resolveUploadType,
  signPresignToken,
  sniffMimeType,
  validatePresignRequest,
  verifyPresignedObject,
  verifyPresignToken,
} from "../../src/server/uploads";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF = new TextEncoder().encode("%PDF-1.7\n%....");
const HTML = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

function collection(upload: UploadOptions | boolean): AnyCollection {
  return { slug: "media", upload } as unknown as AnyCollection;
}

async function rejects(p: Promise<unknown>, code: XenonErrorCode) {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(XenonError);
    expect((err as XenonError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe("sniffMimeType", () => {
  test("recognizes common formats by their bytes", () => {
    expect(sniffMimeType(PNG)).toBe("image/png");
    expect(sniffMimeType(JPEG)).toBe("image/jpeg");
    expect(sniffMimeType(PDF)).toBe("application/pdf");
    expect(sniffMimeType(HTML)).toBeNull();
    expect(sniffMimeType(SVG)).toBeNull();
  });
});

describe("resolveUploadType", () => {
  test("an HTML file declared as PNG is rejected", () => {
    expect(() => resolveUploadType(HTML, "evil.html", "image/png", ["image/png"])).toThrow(XenonError);
  });

  test("bytes that contradict the declared type are rejected", () => {
    expect(() => resolveUploadType(JPEG, "photo.png", "image/png", ["image/*"])).toThrow(XenonError);
  });

  test("extension that contradicts the bytes is rejected", () => {
    expect(() => resolveUploadType(PNG, "photo.jpg", "image/png", ["image/*"])).toThrow(XenonError);
  });

  test("SVG and HTML are never accepted, even under image/*", () => {
    expect(() => resolveUploadType(SVG, "logo.svg", "image/svg+xml", ["image/*"])).toThrow(XenonError);
    expect(() => resolveUploadType(HTML, "page.html", "text/html")).toThrow(XenonError);
  });

  test("a matching PNG is accepted and keeps its sniffed type", () => {
    expect(resolveUploadType(PNG, "photo.png", "image/png", ["image/*"])).toBe("image/png");
  });

  test("an unrecognized file is rejected when the collection restricts types", () => {
    expect(() => resolveUploadType(HTML, "notes.txt", "application/octet-stream", ["image/png"])).toThrow(XenonError);
  });
});

describe("upload bypass regressions", () => {
  const BMP = new Uint8Array([0x42, 0x4d, 0x1e, 0, 0, 0, 0, 0, 0, 0]);
  const TEXT = new TextEncoder().encode("hello, not an image");

  test("active extensions are refused even with an unsniffed image type", () => {
    expect(() => resolveUploadType(BMP, "evil.html", "image/bmp", ["image/*"])).toThrow(XenonError);
    expect(() => resolveUploadType(BMP, "evil.svg", "image/bmp", ["image/*"])).toThrow(XenonError);
    expect(() => resolveUploadType(BMP, "evil.xhtml", "image/x-icon", ["image/*"])).toThrow(XenonError);
  });

  test("markup in the leading bytes is refused under an image type", () => {
    expect(() => resolveUploadType(HTML, "notes.bmp", "image/bmp", ["image/*"])).toThrow(XenonError);
    expect(() => resolveUploadType(SVG, "logo.bmp", "image/bmp", ["image/*"])).toThrow(XenonError);
    expect(() => resolveUploadType(new TextEncoder().encode("  \n<?xml version='1.0'?>"), "x.bmp", "image/bmp")).toThrow(XenonError);
  });

  test("a recognized PNG with a non-image extension is refused", () => {
    expect(() => resolveUploadType(PNG, "evil.html", "image/png", ["image/*"])).toThrow(XenonError);
    expect(() => resolveUploadType(PNG, "photo.bin", "image/png", ["image/*"])).toThrow(XenonError);
    expect(resolveUploadType(PNG, "photo.PNG", "image/png", ["image/*"])).toBe("image/png");
  });

  test("plain text under an image type is refused by the allowlist", () => {
    expect(() => resolveUploadType(TEXT, "note.txt", "text/plain", ["image/*"])).toThrow(XenonError);
  });
});

describe("prepareUpload", () => {
  test("rejects a disguised HTML upload before storage", async () => {
    await rejects(
      prepareUpload(collection({ mimeTypes: ["image/png"] }), {
        data: HTML,
        name: "evil.html",
        type: "image/png",
      }),
      "UNSUPPORTED_MEDIA_TYPE",
    );
  });

  test("stores a real PNG with its sniffed type and filesize", async () => {
    const prepared = await prepareUpload(collection({ mimeTypes: ["image/png"] }), {
      data: PNG,
      name: "photo.png",
      type: "image/png",
    });
    expect(prepared.meta.mimeType).toBe("image/png");
    expect(prepared.meta.filesize).toBe(PNG.byteLength);
  });

  test("enforces maxFileSize", async () => {
    await rejects(
      prepareUpload(collection({ maxFileSize: 4 }), { data: PNG, name: "photo.png", type: "image/png" }),
      "PAYLOAD_TOO_LARGE",
    );
  });

  test("rejects active content types even when MIME parameters are appended", () => {
    expect(() =>
      resolveUploadType(new TextEncoder().encode("hello"), "note.txt", "text/html; charset=utf-8"),
    ).toThrow(XenonError);
    expect(() =>
      resolveUploadType(new TextEncoder().encode("hello"), "note.txt", "image/svg+xml; charset=utf-8"),
    ).toThrow(XenonError);
  });
});

/** Builds a minimal valid PNG header with the given width and height (parseable by `image-size`). */
function makePng(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(24);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR chunk length = 13, type = "IHDR"
  buf.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(buf.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return buf;
}

/** Builds a synthetic JPEG with a large APP1 EXIF padding segment before the SOF0 dimensions marker. */
function makeJpegWithExif(width: number, height: number, exifBytes: number): Uint8Array {
  // SOI (2) + APP1 marker (2) + APP1 len (2) + padding + SOF0 (2) + len (2) + precision (1) + H (2) + W (2) + comps (1)
  const app1Len = exifBytes + 2;
  const buf = new Uint8Array(2 + 2 + app1Len + 11);
  let i = 0;
  buf[i++] = 0xff; buf[i++] = 0xd8; // SOI
  buf[i++] = 0xff; buf[i++] = 0xe1; // APP1
  buf[i++] = (app1Len >> 8) & 0xff; buf[i++] = app1Len & 0xff;
  i += exifBytes;
  buf[i++] = 0xff; buf[i++] = 0xc0; // SOF0
  buf[i++] = 0x00; buf[i++] = 0x0b; // length = 11
  buf[i++] = 8; // precision
  buf[i++] = (height >> 8) & 0xff; buf[i++] = height & 0xff;
  buf[i++] = (width >> 8) & 0xff; buf[i++] = width & 0xff;
  buf[i++] = 1;
  return buf;
}

describe("presigned upload helpers & Critical #2 verification", () => {
  test("validatePresignRequest enforces policy before minting a URL", () => {
    const plan = validatePresignRequest(collection({ mimeTypes: ["image/*"], maxFileSize: 4096 }), {
      filename: "Hero Photo!.PNG",
      mimeType: "image/png",
      size: 2048,
    });
    expect(plan.filename).toBe("hero-photo.png");
    expect(plan.mimeType).toBe("image/png");
    expect(plan.key).toMatch(/^media\/\d{4}\/\d{2}\/[0-9a-f]{10}-hero-photo\.png$/);

    // Empty browser file.type on a safe known extension infers the MIME type for presign (still verified on _complete).
    const inferred = validatePresignRequest(collection({ mimeTypes: ["image/avif"] }), {
      filename: "banner.avif",
      mimeType: "",
      size: 512,
    });
    expect(inferred.mimeType).toBe("image/avif");

    expect(() => validatePresignRequest(collection({ mimeTypes: ["image/*"] }), { filename: "evil.svg", mimeType: "image/svg+xml", size: 10 })).toThrow(XenonError);
    expect(() => validatePresignRequest(collection({ mimeTypes: ["image/*"] }), { filename: "evil.html", mimeType: "image/png", size: 10 })).toThrow(XenonError);
    expect(() => validatePresignRequest(collection({ mimeTypes: ["image/*"] }), { filename: "photo.jpg", mimeType: "image/png", size: 10 })).toThrow(XenonError);
    expect(() => validatePresignRequest(collection({ maxFileSize: 100 }), { filename: "big.png", mimeType: "image/png", size: 101 })).toThrow(XenonError);
    expect(() => validatePresignRequest(collection(true), { filename: "", mimeType: "image/png", size: 10 })).toThrow(XenonError);
    expect(() => validatePresignRequest(collection(true), { filename: "a.png", mimeType: "image/png", size: -5 })).toThrow(XenonError);
  });

  test("verifyPresignedObject extracts dimensions from Range GET (including JPEG with 10 KB EXIF) and enforces limits", async () => {
    const store = new Map<string, { body: Uint8Array; contentType: string | null }>();
    const deleted: string[] = [];
    const rangeCalls: [number, number][] = [];

    const storage: StorageAdapter = {
      name: "fake-s3",
      getUrl: (k) => `https://cdn.example/${k}`,
      async upload() { throw new Error("unused"); },
      async delete(k) { deleted.push(k); store.delete(k); },
      async head(k) {
        const item = store.get(k);
        return item ? { size: item.body.byteLength, contentType: item.contentType } : null;
      },
      async readRange(k, start, end) {
        rangeCalls.push([start, end]);
        const item = store.get(k);
        return item ? item.body.subarray(start, end + 1) : null;
      },
    };

    // Valid PNG -> width & height extracted
    const pngKey = "media/2026/11/0123456789-hero.png";
    store.set(pngKey, { body: makePng(320, 240), contentType: "image/png" });
    const pngResult = await verifyPresignedObject(collection({ mimeTypes: ["image/*"], maxFileSize: 100_000 }), storage, pngKey, "hero.png", "image/png");
    expect(pngResult.meta).toEqual({ filename: "hero.png", mimeType: "image/png", filesize: 24, width: 320, height: 240 });
    expect(rangeCalls[0]).toEqual([0, 23]);

    // JPEG with 10 KB EXIF header + large payload > 64 KB -> single 64 KB Range GET extracts dimensions
    const jpegHead = makeJpegWithExif(1920, 1080, 10_000);
    const fullJpeg = new Uint8Array(100_000);
    fullJpeg.set(jpegHead, 0);
    const jpgKey = "media/2026/11/abcdef0123-photo.jpg";
    store.set(jpgKey, { body: fullJpeg, contentType: "image/jpeg" });
    const jpgResult = await verifyPresignedObject(collection({ mimeTypes: ["image/*"], maxFileSize: 200_000 }), storage, jpgKey, "photo.jpg", "image/jpeg");
    expect(jpgResult.meta).toEqual({ filename: "photo.jpg", mimeType: "image/jpeg", filesize: 100_000, width: 1920, height: 1080 });
    expect(rangeCalls[1]).toEqual([0, PRESIGN_SNIFF_BYTES - 1]);

    // Oversized object caught by HEAD -> deleted immediately WITHOUT calling readRange
    const callsBeforeOversize = rangeCalls.length;
    const bigKey = "media/2026/11/bbbbbbbbbb-big.png";
    store.set(bigKey, { body: makePng(10, 10), contentType: "image/png" });
    await rejects(verifyPresignedObject(collection({ maxFileSize: 10 }), storage, bigKey, "big.png", "image/png"), "PAYLOAD_TOO_LARGE");
    expect(deleted).toContain(bigKey);
    expect(rangeCalls.length).toBe(callsBeforeOversize);

    // Disguised HTML uploaded under image/png -> rejected by Range GET and immediately deleted
    const evilKey = "media/2026/11/eeeeeeeeee-fake.png";
    store.set(evilKey, { body: HTML, contentType: "image/png" });
    await rejects(verifyPresignedObject(collection({ mimeTypes: ["image/png"] }), storage, evilKey, "fake.png", "image/png"), "UNSUPPORTED_MEDIA_TYPE");
    expect(deleted).toContain(evilKey);

    // Active Content-Type reported by storage on HEAD -> rejected and immediately deleted
    const activeHeadKey = "media/2026/11/aaaaaaaaaa-note.txt";
    store.set(activeHeadKey, { body: new TextEncoder().encode("plain"), contentType: "text/html; charset=utf-8" });
    await rejects(verifyPresignedObject(collection(true), storage, activeHeadKey, "note.txt", "text/plain"), "UNSUPPORTED_MEDIA_TYPE");
    expect(deleted).toContain(activeHeadKey);

    // Wrong collection prefix & traversal keys rejected before touching storage
    await rejects(verifyPresignedObject(collection(true), storage, "other/2026/11/a-file.png", "file.png", "image/png"), "BAD_REQUEST");
    await rejects(verifyPresignedObject(collection(true), storage, "media/../other/a.png", "a.png", "image/png"), "BAD_REQUEST");
  });

  test("presign HMAC tokens verify round-trip and reject tampering, wrong secret, and expiry", async () => {
    const secret = "test-presign-secret-0123456789abcdef";
    const now = Date.now();
    const token = await signPresignToken(secret, {
      collection: "media",
      key: "media/2026/11/abc1234567-pic.png",
      filename: "pic.png",
      mimeType: "image/png",
      size: 128,
      userId: "user-1",
      exp: now + 60_000,
    });
    expect(await verifyPresignToken(secret, token, now)).toEqual({
      collection: "media",
      key: "media/2026/11/abc1234567-pic.png",
      filename: "pic.png",
      mimeType: "image/png",
      size: 128,
      userId: "user-1",
      exp: now + 60_000,
    });
    // Tampered token body / signature
    expect(await verifyPresignToken(secret, `${token}x`, now)).toBeNull();
    expect(await verifyPresignToken("other-secret", token, now)).toBeNull();
    // Expired
    expect(await verifyPresignToken(secret, token, now + 60_001)).toBeNull();
    // Non-string
    expect(await verifyPresignToken(secret, null, now)).toBeNull();
  });
});
