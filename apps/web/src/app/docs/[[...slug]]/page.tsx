import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { mdxComponents } from "@/docs/mdx-components";
import { href } from "@/docs/nav";
import { allSlugs, getPage } from "@/docs/source";
import { DocArticle } from "@/docs/ui/doc-article";
import { pageMetadata } from "@/seo/site";
import { articleSchema, StructuredData } from "@/seo/structured-data";

type Props = { params: Promise<{ slug?: string[] }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return allSlugs().map((slug) => ({ slug }));
}

async function resolvePage({ params }: Props) {
  const { slug } = await params;
  return (await getPage(slug ?? [])) ?? notFound();
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { title, description, slug } = await resolvePage(props);
  return pageMetadata(href(slug), `${title} · Xenon Docs`, description);
}

export default async function Page(props: Props) {
  const page = await resolvePage(props);
  return (
    <>
      <StructuredData data={articleSchema(href(page.slug), page.title, page.description)} />
      <DocArticle page={page}><page.Content components={mdxComponents} /></DocArticle>
    </>
  );
}
