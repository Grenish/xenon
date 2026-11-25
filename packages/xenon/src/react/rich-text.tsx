import { createElement, Fragment, type ReactNode } from "react";
import type { RichTextDocument, RichTextMark, RichTextNode } from "../core/types";
import { richTextToPlainText } from "../html/rich-text";
import { safeUrl } from "../html/safe-url";

export { richTextToPlainText, safeUrl };

/*
 * Renders Xenon rich text (Tiptap / ProseMirror JSON) to React. Works in Server Components,
 * has no dependencies, and sanitizes URLs (http(s), mailto, tel and relative only).
 */

export type RichTextComponents = Partial<Record<string, (props: { node: RichTextNode; children: ReactNode }) => ReactNode>>;

export interface RichTextProps {
  value: RichTextDocument | null | undefined;
  /** Override rendering per node type (e.g. `{ image: ({ node }) => <Image … /> }`). */
  components?: RichTextComponents;
  className?: string;
}

function applyMark(mark: RichTextMark, child: ReactNode, key: number): ReactNode {
  switch (mark.type) {
    case "bold":
      return <strong key={key}>{child}</strong>;
    case "italic":
      return <em key={key}>{child}</em>;
    case "underline":
      return <u key={key}>{child}</u>;
    case "strike":
      return <s key={key}>{child}</s>;
    case "code":
      return <code key={key}>{child}</code>;
    case "link": {
      const href = safeUrl(mark.attrs?.href);
      const external = typeof href === "string" && /^https?:/i.test(href);
      return href ? (
        <a key={key} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {child}
        </a>
      ) : (
        child
      );
    }
    default:
      return child;
  }
}

function renderNodes(nodes: RichTextNode[] | undefined, components: RichTextComponents | undefined): ReactNode {
  return nodes?.map((node, i) => <Fragment key={i}>{renderNode(node, components)}</Fragment>);
}

function renderNode(node: RichTextNode, components: RichTextComponents | undefined): ReactNode {
  const children = renderNodes(node.content, components);
  const custom = components?.[node.type];
  if (custom) return custom({ node, children });
  const attrs = node.attrs ?? {};

  switch (node.type) {
    case "text":
      return (node.marks ?? []).reduce<ReactNode>((acc, mark, i) => applyMark(mark, acc, i), node.text ?? "");
    case "paragraph":
      return <p>{children}</p>;
    case "heading": {
      const level = Math.min(6, Math.max(1, Math.trunc(Number(attrs.level)) || 2));
      return createElement(`h${level}`, null, children);
    }
    case "bulletList":
      return <ul>{children}</ul>;
    case "orderedList":
      return <ol start={typeof attrs.start === "number" && attrs.start !== 1 ? attrs.start : undefined}>{children}</ol>;
    case "listItem":
      return <li>{children}</li>;
    case "blockquote":
      return <blockquote>{children}</blockquote>;
    case "codeBlock":
      return (
        <pre>
          <code className={typeof attrs.language === "string" ? `language-${attrs.language}` : undefined}>{children}</code>
        </pre>
      );
    case "hardBreak":
      return <br />;
    case "horizontalRule":
      return <hr />;
    case "image": {
      const src = safeUrl(attrs.src);
      return src ? <img src={src} alt={typeof attrs.alt === "string" ? attrs.alt : ""} title={typeof attrs.title === "string" ? attrs.title : undefined} /> : null;
    }
    default:
      return children;
  }
}

/** `<RichText value={post.body} />` */
export function RichText({ value, components, className }: RichTextProps) {
  if (!value || value.type !== "doc") return null;
  const content = renderNodes(value.content, components);
  return className ? <div className={className}>{content}</div> : <>{content}</>;
}
