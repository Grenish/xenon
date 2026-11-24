import Link from "next/link";
import { getPublishedPosts } from "@/lib-content";

export default async function HomePage() {
  const posts = await getPublishedPosts();

  return (
    <main className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
      <p className="font-mono text-xs uppercase tracking-widest text-[var(--muted)]">XenonCMS / Playground</p>
      <h1 className="mt-8 text-4xl font-semibold tracking-tight sm:text-5xl">Content starts with a schema.</h1>
      <p className="mt-6 max-w-xl text-lg leading-8 text-[var(--muted)]">
        Published posts below are read with the Local API — no HTTP, fully typed. Edit them in{" "}
        <Link href="/admin" className="underline underline-offset-4">/admin</Link>.
      </p>

      <ul className="mt-14 divide-y divide-[var(--line)] border-y border-[var(--line)]">
        {posts.length === 0 && <li className="py-6 text-[var(--muted)]">No published posts yet.</li>}
        {posts.map((post) => (
          <li key={post.id}>
            <Link href={`/posts/${encodeURIComponent(post.slug ?? "")}`} className="group flex items-baseline justify-between gap-6 py-6">
              <span>
                <span className="block text-lg font-medium group-hover:underline group-hover:underline-offset-4">{post.title}</span>
                {post.excerpt && <span className="mt-1 block text-[var(--muted)]">{post.excerpt}</span>}
              </span>
              <span className="shrink-0 font-mono text-xs uppercase tracking-wider text-[var(--muted)]">{post.category}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
