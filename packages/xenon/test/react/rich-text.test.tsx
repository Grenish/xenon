import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { RichTextDocument } from "../../src/core/types";
import { RichText, richTextToPlainText, safeUrl } from "../../src/react/rich-text";
import { normalizeUrl } from "../../src/ui/form/rich-text-editor";

describe("safeUrl", () => {
  test("accepts allowed absolute schemes and safe relative URLs", () => {
    expect(safeUrl("https://example.com/posts?a=1#top")).toBe("https://example.com/posts?a=1#top");
    expect(safeUrl("http://localhost:3000/admin")).toBe("http://localhost:3000/admin");
    expect(safeUrl("  https://example.com  ")).toBe("https://example.com");
    expect(safeUrl("mailto:xenon@grenishrai.pro")).toBe("mailto:xenon@grenishrai.pro");
    expect(safeUrl("tel:+1-555-0100")).toBe("tel:+1-555-0100");
    expect(safeUrl("/posts/hello")).toBe("/posts/hello");
    expect(safeUrl("#section")).toBe("#section");
    expect(safeUrl("?page=2")).toBe("?page=2");
    expect(safeUrl("./photo.png")).toBe("./photo.png");
    expect(safeUrl("../photo.png")).toBe("../photo.png");
    expect(safeUrl("posts/2026:recap")).toBe("posts/2026:recap");
  });

  test("rejects dangerous schemes and control-character obfuscation", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "java\rscript:alert(1)",
      "\u0001javascript:alert(1)",
      "\u0000javascript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
      "blob:https://example.com/uuid",
      "file:///etc/passwd",
      "https:evil.com",
      "http:/evil.com",
      "https://example.com/\tbad",
      "https://example.com/\u007fbad",
    ]) {
      expect(safeUrl(bad)).toBeUndefined();
    }
  });

  test("rejects protocol-relative URLs, leading backslashes, and empty values", () => {
    for (const bad of ["//evil.com/phish", "/\\evil.com", "\\/evil.com", "\\evil.com", "", "   ", "\t\n", null, undefined, 42]) {
      expect(safeUrl(bad)).toBeUndefined();
    }
  });
});

describe("rich-text editor normalizeUrl", () => {
  test("accepts valid URLs and rejects control chars and protocol-relative URLs", () => {
    expect(normalizeUrl("")).toBe("");
    expect(normalizeUrl("example.com")).toBe("https://example.com");
    expect(normalizeUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(normalizeUrl("/docs")).toBe("/docs");
    expect(normalizeUrl("#intro")).toBe("#intro");
    expect(normalizeUrl("mailto:xenon@grenishrai.pro")).toBe("mailto:xenon@grenishrai.pro");
    expect(normalizeUrl("tel:+15550100")).toBe("tel:+15550100");
    for (const bad of ["//evil.com", "/\\evil.com", "\\evil.com", "javascript:alert(1)", "java\tscript:alert(1)", "\u0001javascript:alert(1)", "https:evil.com"]) {
      expect(normalizeUrl(bad)).toBeNull();
    }
  });
});

describe("<RichText>", () => {
  test("strips unsafe link marks and unsafe image sources while rendering safe content", () => {
    const doc: RichTextDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "xss", marks: [{ type: "link", attrs: { href: "java\tscript:alert(1)" } }] },
            { type: "text", text: " " },
            { type: "text", text: "proto-rel", marks: [{ type: "link", attrs: { href: "//evil.com" } }] },
            { type: "text", text: " " },
            { type: "text", text: "ok", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
          ],
        },
        { type: "image", attrs: { src: "java\nscript:alert(1)", alt: "bad" } },
        { type: "image", attrs: { src: "/api/xenon/_files/media/photo.png", alt: "good" } },
        { type: "heading", attrs: { level: 2.9 }, content: [{ type: "text", text: "Title" }] },
      ],
    };

    const html = renderToStaticMarkup(<RichText value={doc} />);
    expect(html).not.toContain("javascript");
    expect(html).not.toContain("//evil.com");
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">ok</a>');
    expect(html).toContain('<img src="/api/xenon/_files/media/photo.png" alt="good"/>');
    expect(html).toContain("<h2>Title</h2>");
    expect(richTextToPlainText(doc)).toBe("xss proto-rel ok\nTitle");
  });
});
