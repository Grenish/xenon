import { allSlugs, docFilename, readArticle } from "@/docs/source";

export const dynamic = "force-static";

async function indexArticle(slug: string[]) {
  try {
    return (await readArticle(slug)).search;
  } catch (error) {
    if (process.env.NODE_ENV !== "development") throw error;
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[docs search] Skipping ${docFilename(slug)}: ${reason}`);
    return [];
  }
}

export async function GET() {
  const sections = await Promise.all(allSlugs().map(indexArticle));
  return Response.json(sections.flat());
}
