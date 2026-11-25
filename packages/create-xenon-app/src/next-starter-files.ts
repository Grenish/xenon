/**
 * Pages of the Next.js starter: a minimal blog with built-in onboarding.
 * Kept as plain template strings; the generated code avoids backticks and "${" so nothing here
 * needs escaping. `siteName` is the only interpolation.
 */

export const DOCS_URL = "https://xenon.grenishrai.pro/docs";

export function layoutTsx(siteName: string): string {
  return `import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Syne } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });
const display = Syne({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-display" });

export const metadata: Metadata = {
  title: ${JSON.stringify(siteName)},
  description: "Powered by XenonCMS",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={[sans.variable, mono.variable, display.variable].join(" ")}>
      <body>{children}</body>
    </html>
  );
}
`;
}

export function siteTsx(siteName: string): string {
  return `import Link from "next/link";

export const SITE_NAME = ${JSON.stringify(siteName)};
export const DOCS_URL = ${JSON.stringify(DOCS_URL)};

export function Header() {
  return (
    <header className="top">
      <Link href="/" className="brand">{SITE_NAME}</Link>
      <nav className="top-nav">
        <a href={DOCS_URL}>Docs</a>
        <Link href="/admin">Admin</Link>
      </nav>
    </header>
  );
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
}

export const CATEGORY_LABEL: Record<string, string> = { news: "News", guide: "Guide", release: "Release" };
`;
}

export const contentTs = `import { getXenon } from "xenon-cms/next";
import { countUsers } from "xenon-cms/http";
import config, { type Post } from "@/xenon.config";

export type Cover = { url: string; alt: string; width: number | null; height: number | null };
export type PostWithCover = { post: Post; cover: Cover | null };

const xenon = () => getXenon(config);

async function coverOf(id: string | null | undefined): Promise<Cover | null> {
  if (!id) return null;
  const media = await xenon().findById({ collection: "media", id });
  return media ? { url: media.url, alt: media.alt, width: media.width ?? null, height: media.height ?? null } : null;
}

/** Published posts, newest first, with their cover images. */
export async function getPosts(): Promise<PostWithCover[]> {
  const { docs } = await xenon().find({ collection: "posts", sort: "-createdAt", limit: 20 });
  return Promise.all(docs.map(async (post) => ({ post, cover: await coverOf(post.cover) })));
}

export async function getPost(slug: string): Promise<PostWithCover | null> {
  const post = await xenon().findBySlug({ collection: "posts", slug });
  return post ? { post, cover: await coverOf(post.cover) } : null;
}

/** Whether the first admin account exists yet (drives the onboarding checklist). */
export async function hasAdmin(): Promise<boolean> {
  return (await countUsers(xenon())) > 0;
}
`;

export const pageTsx = `import Link from "next/link";
import { connection } from "next/server";
import { getPosts, hasAdmin } from "@/lib/content";
import { CATEGORY_LABEL, DOCS_URL, Header, SITE_NAME, formatDate } from "@/lib/site";

const QUERY = [
  "const { docs } = await getXenon(config).find({",
  '  collection: "posts",',
  '  sort: "-createdAt",',
  "});",
].join("\\n");

export default async function HomePage() {
  await connection(); // render on every request, so new posts show up without a rebuild
  const posts = await getPosts();

  return (
    <div className="page">
      <Header />
      <main className="main">
        {posts.length === 0 ? <Onboarding adminCreated={await hasAdmin()} /> : (
          <>
            <section className="intro">
              <h1>{SITE_NAME}</h1>
              <p>Edit this page in <code>app/page.tsx</code>.</p>
            </section>
            <ul className="posts">
              {posts.map(({ post, cover }) => (
                <li key={post.id}>
                  <Link href={"/posts/" + encodeURIComponent(post.slug ?? post.id)} className="post-row">
                    <span className="post-row__meta">
                      <time dateTime={post.createdAt}>{formatDate(post.createdAt)}</time>
                      <span>{CATEGORY_LABEL[post.category ?? ""] ?? "Post"}</span>
                    </span>
                    <span className="post-row__text">
                      <span className="post-row__title">{post.title}</span>
                      {post.excerpt ? <span className="post-row__excerpt">{post.excerpt}</span> : null}
                    </span>
                    {cover ? <img className="post-row__thumb" src={cover.url} alt="" loading="lazy" /> : <span aria-hidden="true" />}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
      <footer className="foot">
        <span>Built with Xenon</span>
        <a href={DOCS_URL}>Documentation</a>
      </footer>
    </div>
  );
}

function Onboarding({ adminCreated }: { adminCreated: boolean }) {
  const steps = [
    { title: "Create your admin account", detail: "The first account you create in the admin becomes the administrator.", href: "/admin", action: "Open the admin", done: adminCreated },
    { title: "Publish your first post", detail: "Give it a cover image and an excerpt and it shows up on this page.", href: "/admin/collections/posts/new", action: "Write a post", done: false },
    { title: "Make this page yours", detail: "It's a normal Next.js page in app/page.tsx. Change anything.", href: DOCS_URL, action: "Read the docs", done: false },
  ];
  const current = steps.findIndex((step) => !step.done);
  const state = (i: number) => (steps[i]!.done ? "done" : i === current ? "current" : "todo");

  return (
    <section aria-labelledby="onboarding-title">
      <h1 id="onboarding-title" className="onboarding-title">Your site is ready for its first post.</h1>
      <div className="progress" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={steps.filter((s) => s.done).length}>
        {steps.map((step, i) => <span key={step.title} data-state={state(i)} />)}
      </div>
      <ol className="steps">
        {steps.map((step, i) => (
          <li key={step.title} className="step" data-state={state(i)}>
            <p className="step__label">{step.done ? "Done" : i === current ? "Next" : "Later"}</p>
            <p className="step__title">{step.title}</p>
            <p className="step__detail">{step.detail}</p>
            {i === current ? (
              step.href.startsWith("http") ? <a href={step.href} className="button">{step.action}</a> : <Link href={step.href} className="button">{step.action}</Link>
            ) : null}
          </li>
        ))}
      </ol>
      <figure className="code">
        <figcaption>app/page.tsx</figcaption>
        <pre><code>{QUERY}</code></pre>
      </figure>
      <p className="hint">New to Xenon? <a href={DOCS_URL}>Read the documentation</a> for collections, fields and querying.</p>
    </section>
  );
}
`;

export const postPageTsx = `import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { RichText } from "xenon-cms/react";
import { getPost } from "@/lib/content";
import { CATEGORY_LABEL, Header, formatDate } from "@/lib/site";

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const found = await getPost(decodeURIComponent(slug));
  if (!found) notFound();
  const { post, cover } = found;

  return (
    <div className="page">
      <Header />
      <main className="main main--article">
        <article className="article">
          <Link href="/" className="back">← All posts</Link>
          <p className="article__meta">
            <span>{CATEGORY_LABEL[post.category ?? ""] ?? "Post"}</span>
            <time dateTime={post.createdAt}>{formatDate(post.createdAt)}</time>
          </p>
          <h1>{post.title}</h1>
          {post.excerpt ? <p className="article__dek">{post.excerpt}</p> : null}
          {cover ? <img className="article__cover" src={cover.url} alt={cover.alt} width={cover.width ?? undefined} height={cover.height ?? undefined} /> : null}
          <div className="prose"><RichText value={post.body} /></div>
          <footer className="article__foot">
            <Link href={"/admin/collections/posts/" + post.id} className="button button--quiet">Edit this post</Link>
          </footer>
        </article>
      </main>
    </div>
  );
}
`;

export const globalsCss = `/* Starter styles: plain CSS, no framework. Change anything. */
:root {
  --bg: #0e1014;
  --panel: #151920;
  --text: #e8ecf3;
  --muted: #8a93a3;
  --line: #232934;
  --accent: #a9b8ff;
  color-scheme: dark;
}

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--text); font-family: var(--font-sans), system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
h1, h2, h3, p, ol, ul, figure, pre, blockquote { margin: 0; }
ol, ul { padding: 0; list-style: none; }
img { display: block; max-width: 100%; height: auto; }
a { color: inherit; text-decoration: none; }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
code, pre { font-family: var(--font-mono), ui-monospace, monospace; }

.page { min-height: 100vh; display: flex; flex-direction: column; }
.top { width: 100%; max-width: 1080px; margin: 0 auto; padding: 0 24px; height: 72px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); }
.brand { font: 700 17px/1 var(--font-display), sans-serif; }
.top-nav { display: flex; gap: 22px; font-size: 14px; color: var(--muted); }
.top-nav a:hover { color: var(--text); }
.main { flex: 1; width: 100%; max-width: 1080px; margin: 0 auto; padding: clamp(40px, 8vw, 104px) 24px 96px; }
.foot { width: 100%; max-width: 1080px; margin: 0 auto; padding: 28px 24px 40px; display: flex; justify-content: space-between; gap: 16px; border-top: 1px solid var(--line); font-size: 13px; color: var(--muted); }
.foot a:hover { color: var(--text); }

/* onboarding */
.onboarding-title { max-width: 14ch; font: 700 clamp(38px, 6.5vw, 72px)/1.02 var(--font-display), sans-serif; letter-spacing: -0.02em; }
.progress { margin-top: 56px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.progress span { height: 4px; border-radius: 999px; background: var(--line); }
.progress span[data-state="done"] { background: var(--text); }
.progress span[data-state="current"] { background: var(--accent); }
.steps { margin-top: 20px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.step { padding-right: 18px; }
.step__label { font: 500 11px/1 var(--font-mono), monospace; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.step[data-state="current"] .step__label { color: var(--accent); }
.step__title { margin-top: 12px; font-weight: 600; font-size: 17px; }
.step[data-state="done"] .step__title { color: var(--muted); text-decoration: line-through; text-decoration-color: var(--line); }
.step__detail { margin-top: 6px; color: var(--muted); font-size: 14.5px; line-height: 1.55; }
.button { display: inline-flex; margin-top: 16px; padding: 10px 16px; border-radius: 999px; font-size: 14px; font-weight: 500; background: var(--text); color: var(--bg); }
.button:hover { background: #fff; }
.button--quiet { margin-top: 0; background: transparent; color: var(--text); box-shadow: inset 0 0 0 1px var(--line); }
.button--quiet:hover { background: var(--panel); }
.code { margin-top: 56px; max-width: 560px; border-radius: 12px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); overflow: hidden; }
.code figcaption { padding: 12px 16px; font: 500 12px/1 var(--font-mono), monospace; color: var(--muted); border-bottom: 1px solid var(--line); }
.code pre { padding: 16px; font-size: 13.5px; line-height: 1.7; overflow-x: auto; }
.hint { margin-top: 28px; color: var(--muted); font-size: 14.5px; }
.hint a { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }

/* posts */
.intro h1 { font: 700 clamp(40px, 7vw, 80px)/1 var(--font-display), sans-serif; letter-spacing: -0.02em; }
.intro p { margin-top: 16px; color: var(--muted); }
.intro code { font-size: 0.9em; color: var(--text); }
.posts { margin-top: 56px; border-top: 1px solid var(--line); }
.post-row { display: grid; grid-template-columns: 150px 1fr 176px; gap: 28px; align-items: center; padding: 26px 0; border-bottom: 1px solid var(--line); }
.post-row__meta { display: grid; gap: 8px; font: 12px/1 var(--font-mono), monospace; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
.post-row__title { display: block; font: 600 clamp(20px, 2.4vw, 26px)/1.2 var(--font-display), sans-serif; letter-spacing: -0.01em; }
.post-row:hover .post-row__title { text-decoration: underline; text-underline-offset: 4px; text-decoration-thickness: 1px; }
.post-row__excerpt { display: block; margin-top: 8px; color: var(--muted); font-size: 15px; line-height: 1.55; }
.post-row__thumb { width: 176px; aspect-ratio: 16 / 10; object-fit: cover; border-radius: 10px; }

/* article */
.main--article { max-width: 760px; }
.back { font-size: 14px; color: var(--muted); }
.back:hover { color: var(--text); }
.article__meta { margin-top: 36px; display: flex; flex-wrap: wrap; gap: 18px; font: 12px/1 var(--font-mono), monospace; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.article h1 { margin-top: 18px; font: 700 clamp(34px, 5.6vw, 58px)/1.04 var(--font-display), sans-serif; letter-spacing: -0.02em; }
.article__dek { margin-top: 18px; font-size: 19px; line-height: 1.55; color: var(--muted); }
.article__cover { margin-top: 40px; width: 100%; border-radius: 12px; }
.article__foot { margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--line); }

.prose { margin-top: 40px; font-size: 1.0625rem; line-height: 1.75; color: #c9d0dc; }
.prose > * + * { margin-top: 1.1em; }
.prose h2, .prose h3 { margin-top: 2em; color: var(--text); font-family: var(--font-display), sans-serif; line-height: 1.25; }
.prose h2 { font-size: 1.5rem; }
.prose h3 { font-size: 1.2rem; }
.prose ul, .prose ol { padding-left: 1.3em; }
.prose ul { list-style: disc; }
.prose ol { list-style: decimal; }
.prose li + li { margin-top: 0.35em; }
.prose a { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
.prose blockquote { padding-left: 1.1em; border-left: 2px solid var(--line); color: var(--muted); font-style: italic; }
.prose code { font-size: 0.88em; padding: 0.15em 0.35em; border-radius: 5px; background: var(--panel); }
.prose pre { padding: 1em 1.2em; border-radius: 10px; overflow-x: auto; background: var(--panel); }
.prose pre code { padding: 0; background: none; }
.prose img { border-radius: 10px; }

@media (max-width: 760px) {
  .progress, .steps { grid-template-columns: 1fr; }
  .progress { gap: 6px; }
  .post-row { grid-template-columns: 1fr; gap: 14px; }
  .post-row__meta { display: flex; gap: 14px; }
  .post-row__thumb { width: 100%; order: -1; }
}
`;
