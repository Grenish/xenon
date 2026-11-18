import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { RichText } from "xenon-cms/react";
import { getMediaUrl, getPost, getPublishedPosts } from "@/lib-content";

/**
 * Prerender every published post so the whole page is served from the cache. Posts published later
 * render on first request and are cached from then on; Xenon expires the tags when they change.
 */
export async function generateStaticParams() {
  const slugs = (await getPublishedPosts()).flatMap((post) => (post.slug ? [{ slug: post.slug }] : []));
  // With cacheComponents, at least one param is required; an unknown slug just renders the 404.
  return slugs.length ? slugs : [{ slug: "__none__" }];
}

export default function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto max-w-2xl px-6 py-20 text-[var(--muted)]">Loading…</main>}>
      <Post params={params} />
    </Suspense>
  );
}

async function Post({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();
  const cover = await getMediaUrl(post.cover);

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <Link href="/" className="font-mono text-xs uppercase tracking-widest text-[var(--muted)] hover:underline">← All posts</Link>
      <p className="mt-10 font-mono text-xs uppercase tracking-wider text-[var(--muted)]">
        {post.category}
        {post.readingTime ? ` · ${post.readingTime} min read` : ""}
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">{post.title}</h1>
      {post.excerpt && <p className="mt-4 text-lg text-[var(--muted)]">{post.excerpt}</p>}
      {cover && (
        // biome-ignore lint/performance/noImgElement: playground demo
        <img src={cover.url} alt={cover.alt} width={cover.width ?? undefined} height={cover.height ?? undefined} className="mt-10 w-full rounded-lg" />
      )}
      <RichText value={post.body} className="prose-playground mt-10 space-y-4 leading-7 [&_a]:underline [&_h2]:mt-8 [&_h2]:text-2xl [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6" />
    </main>
  );
}
