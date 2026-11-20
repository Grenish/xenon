import { href, nav } from "@/docs/nav";
import { readSource } from "@/docs/source";
import { docCardId } from "@/seo/site";
import { cardSize, socialCard } from "@/seo/social-card";

const articles = nav.flatMap(({ title: section, pages }) =>
  pages.map(({ slug, title }) => ({
    id: docCardId(href(slug)), section, slug, title,
  })),
);

export function generateImageMetadata() {
  return articles.map(({ id, title }) => ({
    id, alt: `${title} · Xenon Docs`, size: cardSize, contentType: "image/png",
  }));
}

export default async function DocumentationImage({ id }: { id: Promise<string> }) {
  const key = await id;
  const article = articles.find(({ id }) => id === key);
  if (!article) return new Response(null, { status: 404 });
  const { title } = await readSource(article.slug);
  return socialCard({ section: article.section, title });
}
