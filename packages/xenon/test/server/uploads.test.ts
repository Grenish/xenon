import { describe, expect, test } from "bun:test";
import { XenonError, type XenonErrorCode } from "../../src/core/errors";
import type { AnyCollection, UploadOptions } from "../../src/core/types";
import { prepareUpload, resolveUploadType, sniffMimeType } from "../../src/server/uploads";

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
});
