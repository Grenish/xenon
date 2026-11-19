import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { compile, createProcessor, run } from "@mdx-js/mdx";
import type { MDXComponents } from "mdx/types";
import { cache, type ReactNode } from "react";
import * as runtime from "react/jsx-runtime";
import remarkGfm from "remark-gfm";
import { bundledLanguages, codeToHast, createCssVariablesTheme, type BundledLanguage } from "shiki";
import { href, nav } from "./nav";

export type TocItem = { id: string; text: string; depth: 2 | 3 };
export type PageLink = { title: string; href: string };
export type DocPage = {
  slug: string[];
  title: string;
  description: string;
  toc: TocItem[];
  prev: PageLink | null;
  next: PageLink | null;
  editUrl: string;
  Content: (props: { components: MDXComponents }) => ReactNode;
};
export type SearchRecord = { url: string; page: string; heading: string; text: string };

const pages = nav.flatMap((section) => section.pages);
export const contentDirectory = join(process.cwd(), "content", "docs");

export function allSlugs(): string[][] {
  return pages.map((page) => page.slug);
}

export function docFilename(slug: string[]): string {
  return (slug.join("/") || "index") + ".mdx";
}

function splitFrontmatter(source: string) {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(source);
  if (!match) throw new Error("Expected title and description between --- lines");
  const fields = new Map<string, string>();
  for (const line of match[1].split("\n")) {
    if (!line.trim()) continue;
    const field = /^(title|description):\s*(.+?)\s*$/.exec(line);
    if (!field || fields.has(field[1])) throw new Error(`Invalid or duplicate frontmatter field: ${line}`);
    let value = field[2];
    if (value.startsWith('"')) value = JSON.parse(value);
    else if (value.startsWith("'")) {
      if (!value.endsWith("'")) throw new Error(`Unclosed quote in ${field[1]}`);
      value = value.slice(1, -1).replaceAll("''", "'");
    }
    fields.set(field[1], value.trim());
  }
  const title = fields.get("title");
  const description = fields.get("description");
  if (!title || !description) throw new Error("Both title and description must have a value");
  if ([...description].length > 160) throw new Error("Description exceeds 160 characters");
  return { title, description, body: source.slice(match[0].length) };
}

type MarkdownTree = ReturnType<ReturnType<typeof createProcessor>["parse"]>;
type MarkdownNode = MarkdownTree | MarkdownTree["children"][number];
type HtmlTree = Awaited<ReturnType<typeof codeToHast>>;
type HtmlNode = HtmlTree | HtmlTree["children"][number];
const components = new Set(["Install", "Tabs", "Tab", "Callout", "Steps", "Cards", "Card"]);

function headingText(node: MarkdownNode): string {
  if ("children" in node) return node.children.map(headingText).join("");
  if ("value" in node) return node.value;
  if ("alt" in node) return node.alt || "";
  return "";
}

type ComponentNode = Extract<MarkdownNode, { type: "mdxJsxFlowElement" | "mdxJsxTextElement" }>;

function inspectComponent(node: ComponentNode, links: string[]) {
  if (!node.name || !components.has(node.name)) throw new Error(`Unsupported element <${node.name || ""}>`);
  for (const attr of node.attributes) {
    if (attr.type !== "mdxJsxAttribute") throw new Error("JSX spread attributes are unsupported");
    if (attr.value && typeof attr.value === "object") {
      const statement = attr.value.data?.estree?.body[0];
      const expression = statement?.type === "ExpressionStatement" ? statement.expression : null;
      const tabLabels = node.name === "Tabs" && attr.name === "items" && expression?.type === "ArrayExpression"
        && expression.elements.every((item) => item?.type === "Literal" && typeof item.value === "string");
      if (!tabLabels) throw new Error(`Expected a literal value for ${node.name}.${attr.name}`);
    }
    if (node.name === "Card" && attr.name === "href" && typeof attr.value === "string") links.push(attr.value);
  }
}

function nextHeadingId(text: string, ids: Set<string>) {
  const base = text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim().replace(/\s+/g, "-") || "section";
  let id = base;
  for (let suffix = 1; ids.has(id); suffix++) id = `${base}-${suffix}`;
  ids.add(id);
  return id;
}

function inspect(tree: MarkdownTree, title: string, url: string) {
  const toc: TocItem[] = [];
  const search: SearchRecord[] = [];
  const links: string[] = [];
  const ids = new Set<string>();
  function visit(node: MarkdownNode, includeText: boolean) {
    if (node.type === "heading") {
      if (node.depth === 1) throw new Error("Use frontmatter for the page title instead of an h1");
      if (node.depth === 2 || node.depth === 3) {
        const text = headingText(node).trim();
        const id = nextHeadingId(text, ids);
        node.data = { ...node.data, hProperties: { id } };
        toc.push({ id, text, depth: node.depth });
        search.push({ url: `${url}#${id}`, page: title, heading: text, text: "" });
        includeText = false;
      }
    }
    if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") inspectComponent(node, links);
    if (node.type === "mdxFlowExpression" || node.type === "mdxTextExpression" || node.type === "mdxjsEsm") {
      throw new Error("Use Markdown or a documented component in the article body");
    }
    if (node.type === "code") {
      if (!node.lang) throw new Error("Code fence needs a language");
      node.data = { ...node.data, hProperties: { "data-meta": node.meta || "" } };
    }
    if (node.type === "link" || node.type === "definition") links.push(node.url);
    if (node.type === "image" && !node.url.startsWith("/docs/")) throw new Error("Images must be under public/docs/");
    if (node.type === "text" || node.type === "inlineCode" || node.type === "code") {
      const section = search.at(-1);
      if (includeText && section) section.text += node.value + " ";
    }
    if ("children" in node) node.children.forEach((child) => visit(child, includeText));
  }
  visit(tree, true);
  for (const record of search) record.text = record.text.trim().replace(/\s+/g, " ");
  return { toc, search, links };
}

const theme = createCssVariablesTheme({ name: "css-variables" });

async function highlight(node: HtmlNode): Promise<void> {
  if (!("children" in node)) return;
  const code = node.children[0];
  if (node.type !== "element" || node.tagName !== "pre" || code?.type !== "element" || code.tagName !== "code") {
    for (const child of node.children) await highlight(child);
    return;
  }
  const classes = code.properties.className;
  const lang = Array.isArray(classes) && String(classes[0]).replace(/^language-/, "");
  if (!lang) return;
  const raw = code.children[0];
  const value = raw?.type === "text" ? raw.value.replace(/\n$/, "") : "";
  const meta = String(code.properties["data-meta"] || "");
  const title = /(?:^|\s)title="([^"]*)"/.exec(meta)?.[1];
  const range = /(?:^|\s)\{([\d\s,-]+)\}/.exec(meta)?.[1];
  const intervals = range?.split(",").map((part) => part.trim().split("-").map(Number)) || [];
  // Unregistered fence languages still render verbatim and keep their language label.
  const language = Object.hasOwn(bundledLanguages, lang) ? lang as BundledLanguage : "text";
  const highlighted = await codeToHast(value, {
    lang: language, theme,
    transformers: [{ line(element, line) {
      if (intervals.some(([start, end = start]) => start <= line && line <= end)) element.properties["data-highlighted"] = "";
    } }],
  });
  const pre = highlighted.children[0];
  if (pre?.type !== "element") throw new Error("Expected a highlighted code block");
  node.children = pre.children;
  node.properties = { ...pre.properties, "data-language": lang };
  if (title) node.properties["data-title"] = title;
  if (range) node.properties["data-highlight"] = range;
}

const parser = createProcessor({ remarkPlugins: [remarkGfm] });

async function readSource(slug: string[]) {
  const path = join(contentDirectory, docFilename(slug));
  const raw = await readFile(path, "utf8");
  return { path, ...splitFrontmatter(raw.replace(/\r\n/g, "\n")) };
}

export async function readArticle(slug: string[]) {
  const { path, body, title } = await readSource(slug);
  return inspect(parser.parse({ path, value: body }), title, href(slug));
}

function pageLink(index: number): PageLink | null {
  const page = pages[index];
  return page ? { title: page.title, href: href(page.slug) } : null;
}

const loadPage = cache(async (index: number): Promise<DocPage> => {
  const { slug } = pages[index];
  const { title, description, body, path } = await readSource(slug);
  let toc: TocItem[] = [];
  const compiled = await compile({ path, value: body }, {
    outputFormat: "function-body",
    remarkPlugins: [remarkGfm, () => (tree: MarkdownTree) => { toc = inspect(tree, title, href(slug)).toc; }],
    rehypePlugins: [() => highlight],
  });
  const { default: Content } = await run(compiled, runtime);
  return {
    title, description, slug, toc, Content,
    prev: pageLink(index - 1), next: pageLink(index + 1),
    editUrl: `https://github.com/Grenish/xenon/edit/main/apps/web/content/docs/${docFilename(slug)}`,
  };
});

export async function getPage(slug: string[]): Promise<DocPage | null> {
  const index = pages.findIndex((page) => page.slug.length === slug.length && page.slug.every((part, i) => part === slug[i]));
  if (index === -1) return null;
  try {
    return await loadPage(index);
  } catch (error) {
    // During authoring, a page can be in the navigation before its file exists.
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}
