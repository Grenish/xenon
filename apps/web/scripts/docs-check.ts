import { readdir } from "node:fs/promises";
import { href } from "../src/docs/nav";
import { allSlugs, contentDirectory, docFilename, readArticle } from "../src/docs/source";

async function checkDocs() {
  const errors: string[] = [];
  const files = new Set((await readdir(contentDirectory, { recursive: true })).filter((file) => file.endsWith(".mdx")));
  const anchors = new Map<string, Set<string> | null>();
  const references: { from: string; link: string }[] = [];

  for (const slug of allSlugs()) {
    const url = href(slug);
    const file = docFilename(slug);
    if (anchors.has(url)) {
      errors.push(`${file}: duplicate sitemap entry`);
      continue;
    }
    if (!files.delete(file)) {
      errors.push(`${file}: missing file`);
      continue;
    }
    anchors.set(url, null);
    try {
      const { links, toc } = await readArticle(slug);
      anchors.set(url, new Set(toc.map((item) => item.id)));
      for (const link of links) references.push({ from: url, link });
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : error}`);
    }
  }

  for (const file of files) errors.push(`${file}: missing from the sitemap`);
  for (const { from, link } of references) {
    try {
      const target = new URL(link, `https://docs.invalid${from}`);
      if (target.origin !== "https://docs.invalid") continue;
      const path = decodeURIComponent(target.pathname).replace(/\/$/, "");
      if (path !== "/docs" && !path.startsWith("/docs/")) continue;
      const ids = anchors.get(path);
      if (ids === undefined || (target.hash && ids && !ids.has(decodeURIComponent(target.hash.slice(1))))) {
        errors.push(`${from}: unresolved link ${link}`);
      }
    } catch {
      errors.push(`${from}: malformed link ${link}`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`Checked ${anchors.size} documentation pages and ${references.length} links.`);
}

checkDocs().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
