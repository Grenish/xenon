"use client";

import { useRef, type ComponentProps } from "react";
import { CopyButton } from "./copy";

const SHELL = new Set(["bash", "sh", "shell", "zsh", "console"]);
const LABEL: Record<string, string> = { ts: "TypeScript", tsx: "TSX", js: "JavaScript", jsx: "JSX", json: "JSON", css: "CSS", sql: "SQL", yaml: "YAML", env: ".env", dotenv: ".env", text: "" };

type PreProps = ComponentProps<"pre"> & { "data-language"?: string; "data-title"?: string };

/**
 * A fenced code block (already highlighted at build). A file-name bar when the fence has `title="…"`; shell blocks
 * get a prompt glyph and copy without it.
 */
export function CodeBlock({ children, "data-language": lang = "", "data-title": title, className = "", ...rest }: PreProps) {
  const pre = useRef<HTMLPreElement>(null);
  const shell = SHELL.has(lang);
  const text = () => {
    const raw = pre.current?.innerText ?? "";
    return (shell ? raw.replace(/^\$ /gm, "") : raw).replace(/\n$/, "");
  };
  const head = title ?? (shell ? "Terminal" : LABEL[lang] ?? lang);
  return (
    <figure className="docs-code" data-shell={shell || undefined}>
      {head ? (
        <figcaption className="docs-code__bar">
          <span className="truncate">{head}</span>
          <CopyButton text={text} />
        </figcaption>
      ) : (
        <CopyButton text={text} className="docs-copy--float" />
      )}
      <pre ref={pre} data-language={lang} className={className} {...rest}>
        {children}
      </pre>
    </figure>
  );
}
