import Link from "next/link";
import type { ComponentProps } from "react";
import { Callout, Card, Cards, Steps } from "./components/blocks";
import { CodeBlock } from "./components/code-block";
import { Install } from "./components/install";
import { Tab, Tabs } from "./components/tabs";

/** A heading the reader can link to: the heading itself is the link to its own anchor. */
function heading(Tag: "h2" | "h3") {
  return function Heading({ id, children, ...rest }: ComponentProps<"h2">) {
    return (
      <Tag id={id} {...rest}>
        {id ? (
          <a href={`#${id}`} className="docs-anchor">
            {children}
          </a>
        ) : (
          children
        )}
      </Tag>
    );
  };
}

function A({ href = "", children, ...rest }: ComponentProps<"a">) {
  if (href.startsWith("/")) return <Link href={href} {...rest}>{children}</Link>;
  if (href.startsWith("#")) return <a href={href} {...rest}>{children}</a>;
  return (
    <a href={href} rel="noreferrer" {...rest}>
      {children}
    </a>
  );
}

/** Tables scroll sideways inside their own box on narrow screens, never the page. */
function Table(props: ComponentProps<"table">) {
  return (
    <div className="docs-table">
      <table {...props} />
    </div>
  );
}

/**
 * The tag → component map the MDX pages render with. The capitalised names are the whole vocabulary content may
 * use (DOCS.md §4); the lowercase ones restyle plain Markdown.
 */
export const mdxComponents = {
  h2: heading("h2"),
  h3: heading("h3"),
  a: A,
  pre: CodeBlock,
  table: Table,
  Install,
  Tabs,
  Tab,
  Callout,
  Steps,
  Cards,
  Card,
};

export type DocsComponents = typeof mdxComponents;
