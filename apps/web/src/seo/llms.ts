import { createProcessor } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";
import { href, nav } from "@/docs/nav";
import { readSource } from "@/docs/source";
import { absolute, repository, summary } from "./site";

const parser = createProcessor({ remarkPlugins: [remarkGfm] });
type Root = ReturnType<typeof parser.parse>;
type Node = Root | Root["children"][number];
type Element = Extract<Node, { type: "mdxJsxFlowElement" | "mdxJsxTextElement" }>;

function attribute(node: Element, name: string) {
  const attr = node.attributes.find((entry) => entry.type === "mdxJsxAttribute" && entry.name === name);
  return attr?.type === "mdxJsxAttribute" && typeof attr.value === "string" ? attr.value : "";
}

// Copy Markdown verbatim (including code fences and tables), replacing just the
// presentation components and link destinations identified by the MDX parser.
export function articleMarkdown(body: string, url: string) {
  function render(node: Node): string {
    const start = node.position!.start.offset!;
    const end = node.position!.end.offset!;
    if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
      const inner = node.children.map(render).join(node.type === "mdxJsxFlowElement" ? "\n\n" : "");
      switch (node.name) {
        case "Install": {
          const dev = node.attributes.some((attr) => attr.type === "mdxJsxAttribute" && attr.name === "dev");
          return `\`\`\`bash\nbun add ${dev ? "-D " : ""}${attribute(node, "pkg")}\n\`\`\``;
        }
        case "Card":
          return `- [${attribute(node, "title")}](${new URL(attribute(node, "href"), url).href})${inner ? " — " + inner : ""}`;
        case "Callout":
          return `**${attribute(node, "tone") === "warning" ? "Warning" : "Note"}**\n\n${inner}`;
        case "Tabs": {
          const attr = node.attributes.find((entry) => entry.type === "mdxJsxAttribute" && entry.name === "items");
          const value = attr?.type === "mdxJsxAttribute" ? attr.value : null;
          const statement = typeof value === "object" && value?.data?.estree?.body[0];
          const expr = statement && statement.type === "ExpressionStatement" && statement.expression;
          const labels = expr && expr.type === "ArrayExpression" ? expr.elements : [];
          return node.children.map((child, index) => {
            const label = labels[index];
            return [label?.type === "Literal" && String(label.value), render(child)].filter(Boolean).join("\n\n");
          }).join("\n\n");
        }
        default:
          return inner;
      }
    }
    if (node.type === "link" && !/^[a-z][a-z\d+.-]*:/i.test(node.url)) {
      return `[${node.children.map(render).join("")}](${new URL(node.url, url).href})`;
    }
    if (!("children" in node)) return body.slice(start, end);
    let cursor = start;
    let text = "";
    for (const child of node.children) {
      text += body.slice(cursor, child.position!.start.offset!) + render(child);
      cursor = child.position!.end.offset!;
    }
    return text + body.slice(cursor, end);
  }
  return render(parser.parse(body)).trim();
}

export async function llmsText(full: boolean) {
  const sections = await Promise.all(nav.map(async ({ title: section, pages }) => {
    const entries = await Promise.all(pages.map(async ({ slug }) => {
      const { title, description, body } = await readSource(slug);
      const url = absolute(href(slug));
      return full
        ? `# ${title}\n\nSource: ${url}\n\n${description}\n\n${articleMarkdown(body, url)}`
        : `- [${title}](${url}): ${description}`;
    }));
    return full ? entries.join("\n\n---\n\n") : `## ${section}\n\n${entries.join("\n")}`;
  }));
  const intro = [
    full ? "# Xenon documentation" : "# Xenon", `> ${summary}`,
    "Xenon runs inside a Next.js App Router application. The local API serves Server Components and the REST API serves external clients. The project uses the MIT license.",
    "## Project",
    [`- [Xenon](${absolute("/")}): Product overview.`,
      `- [Source repository](${repository}): Package source, license, and issue tracker.`,
      `- [${full ? "Documentation index" : "Full documentation"}](${absolute(full ? "/llms.txt" : "/llms-full.txt")})`].join("\n"),
  ];
  return new Response([...intro, ...sections].join("\n\n") + "\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
