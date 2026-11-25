import type { RichTextDocument, RichTextMark, RichTextNode } from "../core/types";
import { safeUrl } from "./safe-url";

/*
 * Framework-agnostic HTML renderer for Xenon rich text (Tiptap / ProseMirror JSON).
 * Zero React dependency. Escapes all text and attribute values and shares `safeUrl()`
 * with `xenon-cms/react`.
 */

export interface HtmlNodeProps {
  node: RichTextNode;
  /** Already-rendered inner HTML of `node.content`. */
  children: string;
}

export interface HtmlBlockProps extends HtmlNodeProps {
  blockType: string;
  data: Record<string, unknown>;
}

export type HtmlNodeRenderer = (props: HtmlNodeProps) => string;
export type HtmlBlockRenderer = (props: HtmlBlockProps) => string;

export interface RenderRichTextHtmlOptions {
  /**
   * Custom renderers for embedded block nodes (e.g. `defineBlock()` embeds with
   * `node.type === "block"` + `attrs.blockType`, or custom node types keyed directly by name).
   * Renderers return trusted HTML strings; escape untrusted fields with `escapeHtml()`.
   */
  blocks?: Partial<Record<string, HtmlBlockRenderer>>;
  /** Override rendering per ProseMirror node type (mirrors `<RichText components={...} />`). */
  components?: Partial<Record<string, HtmlNodeRenderer>>;
  /** Wrap the rendered HTML in `<div class="...">...</div>` when supplied. */
  className?: string;
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes HTML text and attribute values (`&`, `<`, `>`, `"`, `'`). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]!);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function applyMark(mark: RichTextMark, child: string): string {
  switch (mark.type) {
    case "bold":
      return `<strong>${child}</strong>`;
    case "italic":
      return `<em>${child}</em>`;
    case "underline":
      return `<u>${child}</u>`;
    case "strike":
      return `<s>${child}</s>`;
    case "code":
      return `<code>${child}</code>`;
    case "link": {
      const href = safeUrl(mark.attrs?.href);
      if (!href) return child;
      const external = /^https?:/i.test(href);
      const rel = external ? ' target="_blank" rel="noopener noreferrer"' : "";
      return `<a href="${escapeHtml(href)}"${rel}>${child}</a>`;
    }
    default:
      return child;
  }
}

function renderNodes(nodes: RichTextNode[] | undefined, options: RenderRichTextHtmlOptions | undefined): string {
  if (!nodes?.length) return "";
  let out = "";
  for (const node of nodes) out += renderNode(node, options);
  return out;
}

function renderNode(node: RichTextNode, options: RenderRichTextHtmlOptions | undefined): string {
  const children = renderNodes(node.content, options);
  const custom = options?.components?.[node.type];
  if (custom) return custom({ node, children });

  const attrs = isPlainRecord(node.attrs) ? node.attrs : {};

  if (node.type === "block" || node.type === "xenonBlock") {
    const blockType = typeof attrs.blockType === "string"
      ? attrs.blockType
      : typeof attrs.type === "string"
        ? attrs.type
        : undefined;
    const blockRenderer = blockType ? options?.blocks?.[blockType] : undefined;
    if (blockRenderer && blockType) {
      const data = isPlainRecord(attrs.data) ? attrs.data : attrs;
      return blockRenderer({ blockType, data, node, children });
    }
    return children;
  }

  const directBlock = options?.blocks?.[node.type];
  if (directBlock) {
    const data = isPlainRecord(attrs.data) ? attrs.data : attrs;
    return directBlock({ blockType: node.type, data, node, children });
  }

  switch (node.type) {
    case "text":
      return (node.marks ?? []).reduce<string>((acc, mark) => applyMark(mark, acc), escapeHtml(node.text ?? ""));
    case "paragraph":
      return `<p>${children}</p>`;
    case "heading": {
      const level = Math.min(6, Math.max(1, Math.trunc(Number(attrs.level)) || 2));
      return `<h${level}>${children}</h${level}>`;
    }
    case "bulletList":
      return `<ul>${children}</ul>`;
    case "orderedList": {
      const start = typeof attrs.start === "number" && Number.isFinite(attrs.start) ? Math.trunc(attrs.start) : 1;
      return `<ol${start !== 1 ? ` start="${start}"` : ""}>${children}</ol>`;
    }
    case "listItem":
      return `<li>${children}</li>`;
    case "blockquote":
      return `<blockquote>${children}</blockquote>`;
    case "codeBlock": {
      const lang = typeof attrs.language === "string" && attrs.language.length > 0
        ? ` class="language-${escapeHtml(attrs.language)}"`
        : "";
      return `<pre><code${lang}>${children}</code></pre>`;
    }
    case "hardBreak":
      return "<br>";
    case "horizontalRule":
      return "<hr>";
    case "image": {
      const src = safeUrl(attrs.src);
      if (!src) return "";
      const alt = typeof attrs.alt === "string" ? attrs.alt : "";
      const title = typeof attrs.title === "string" ? ` title="${escapeHtml(attrs.title)}"` : "";
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${title}>`;
    }
    default:
      return children;
  }
}

/**
 * Renders Xenon rich text (Tiptap / ProseMirror JSON) to an HTML string without React.
 * Returns `""` for nullish or non-`"doc"` inputs.
 */
export function renderRichTextToHtml(
  value: RichTextDocument | null | undefined,
  options?: RenderRichTextHtmlOptions,
): string {
  if (!value || value.type !== "doc") return "";
  const content = renderNodes(value.content, options);
  return options?.className ? `<div class="${escapeHtml(options.className)}">${content}</div>` : content;
}

/** Plain-text version (excerpts, meta descriptions). */
export function richTextToPlainText(value: RichTextDocument | null | undefined): string {
  const walk = (nodes: RichTextNode[] | undefined): string =>
    (nodes ?? [])
      .map((n) => (n.type === "text" ? (n.text ?? "") : n.type === "hardBreak" ? "\n" : walk(n.content) + (["paragraph", "heading", "listItem", "blockquote", "codeBlock"].includes(n.type) ? "\n" : "")))
      .join("");
  return walk(value?.content).replace(/\n{2,}/g, "\n").trim();
}
