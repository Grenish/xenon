import { describe, expect, test } from "bun:test";
import type { RichTextDocument } from "../../src/core/types";
import { escapeHtml, renderRichTextToHtml, richTextToPlainText, safeUrl } from "../../src/html/index";
import { safeUrl as reactSafeUrl } from "../../src/react/rich-text";

describe("xenon-cms/html", () => {
  test("shares the exact safeUrl function with xenon-cms/react", () => {
    expect(safeUrl).toBe(reactSafeUrl);
  });

  test("returns empty string for nullish or invalid documents", () => {
    expect(renderRichTextToHtml(null)).toBe("");
    expect(renderRichTextToHtml(undefined)).toBe("");
    expect(renderRichTextToHtml({ type: "other" } as unknown as RichTextDocument)).toBe("");
  });

  test("renders standard nodes, marks, escaping, and optional wrapper className", () => {
    const doc: RichTextDocument = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 9 }, content: [{ type: "text", text: "H6 <Title> & \"Quotes\"" }] },
        { type: "heading", attrs: { level: 0 }, content: [{ type: "text", text: "Default H2" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: " " },
            { type: "text", text: "combo", marks: [{ type: "italic" }, { type: "underline" }, { type: "strike" }, { type: "code" }] },
            { type: "hardBreak" },
            { type: "text", text: "internal", marks: [{ type: "link", attrs: { href: "/docs/intro" } }] },
            { type: "text", text: " " },
            { type: "text", text: "external", marks: [{ type: "link", attrs: { href: "https://example.com/?a=1&b=2" } }] },
          ],
        },
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }] }],
        },
        {
          type: "orderedList",
          attrs: { start: 3 },
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Three" }] }] }],
        },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Quoted" }] }] },
        { type: "codeBlock", attrs: { language: 'ts" onload="x' }, content: [{ type: "text", text: "const x = 1 < 2;" }] },
        { type: "horizontalRule" },
        { type: "image", attrs: { src: "/api/xenon/_files/media/a.png", alt: 'A "quote" & <tag>', title: "Caption" } },
      ],
    };

    const html = renderRichTextToHtml(doc, { className: 'prose "x"' });
    expect(html.startsWith('<div class="prose &quot;x&quot;">')).toBe(true);
    expect(html.endsWith("</div>")).toBe(true);
    expect(html).toContain("<h6>H6 &lt;Title&gt; &amp; &quot;Quotes&quot;</h6>");
    expect(html).toContain("<h2>Default H2</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code><s><u><em>combo</em></u></s></code>");
    expect(html).toContain("<br>");
    expect(html).toContain('<a href="/docs/intro">internal</a>');
    expect(html).toContain('<a href="https://example.com/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">external</a>');
    expect(html).toContain("<ul><li><p>One</p></li></ul>");
    expect(html).toContain('<ol start="3"><li><p>Three</p></li></ol>');
    expect(html).toContain("<blockquote><p>Quoted</p></blockquote>");
    expect(html).toContain('<pre><code class="language-ts&quot; onload=&quot;x">const x = 1 &lt; 2;</code></pre>');
    expect(html).toContain("<hr>");
    expect(html).toContain('<img src="/api/xenon/_files/media/a.png" alt="A &quot;quote&quot; &amp; &lt;tag&gt;" title="Caption">');
    expect(richTextToPlainText(doc)).toContain("H6 <Title> & \"Quotes\"");
  });

  test("strips unsafe link marks and unsafe image sources", () => {
    const doc: RichTextDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "js", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
            { type: "text", text: " " },
            { type: "text", text: "ctrl", marks: [{ type: "link", attrs: { href: "java\tscript:alert(1)" } }] },
            { type: "text", text: " " },
            { type: "text", text: "proto", marks: [{ type: "link", attrs: { href: "//evil.example/x" } }] },
          ],
        },
        { type: "image", attrs: { src: "data:text/html,<script>alert(1)</script>", alt: "bad" } },
        { type: "image", attrs: { src: "javascript:alert(1)", alt: "bad2" } },
      ],
    };

    const html = renderRichTextToHtml(doc);
    expect(html).toBe("<p>js ctrl proto</p>");
    expect(html).not.toContain("javascript");
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("<img");
  });

  test("renders embedded blocks via options.blocks and supports component overrides", () => {
    const doc: RichTextDocument = {
      type: "doc",
      content: [
        {
          type: "block",
          attrs: { blockType: "callout", data: { tone: "info", title: "Heads <up>" } },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }],
        },
        {
          type: "cta",
          attrs: { label: "Start", href: "https://xenon.example" },
        },
        {
          type: "block",
          attrs: { blockType: "unregistered" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Fallback" }] }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Custom" }],
        },
      ],
    };

    const html = renderRichTextToHtml(doc, {
      blocks: {
        callout: ({ blockType, data, children }) =>
          `<aside data-block="${escapeHtml(blockType)}" data-tone="${escapeHtml(String(data.tone))}"><strong>${escapeHtml(String(data.title))}</strong>${children}</aside>`,
        cta: ({ data }) => `<a class="cta" href="${escapeHtml(safeUrl(data.href) ?? "#")}">${escapeHtml(String(data.label))}</a>`,
      },
      components: {
        paragraph: ({ children }) => `<p class="p">${children}</p>`,
      },
    });

    expect(html).toContain('<aside data-block="callout" data-tone="info"><strong>Heads &lt;up&gt;</strong><p class="p">Body</p></aside>');
    expect(html).toContain('<a class="cta" href="https://xenon.example">Start</a>');
    expect(html).toContain('<p class="p">Fallback</p>');
    expect(html).toContain('<p class="p">Custom</p>');
  });
});
