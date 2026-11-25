/**
 * C · Tiles — a bright grid of cards.
 * Signature: in the empty state, ghost tiles stand where posts will go, each one teaching a field.
 */
import Link from "next/link";
import { RichText } from "xenon-cms/react";
import {
  CATEGORY_LABEL, NEW_POST_HREF, QUERY_SNIPPET, SITE_NAME, editHref, formatDate, homeHref, postHref, readingMinutes, setupSteps,
  type PostCard, type Setup,
} from "../data";

function Top() {
  return (
    <header className="ti-top">
      <Link href={homeHref} className="ti-brand">{SITE_NAME}</Link>
      <Link href="/admin" className="ti-pill">Admin</Link>
    </header>
  );
}

function Chip({ category }: { category: string | null | undefined }) {
  const key = category ?? "post";
  return <span className="ti-chip" data-category={key}>{CATEGORY_LABEL[key] ?? "Post"}</span>;
}

/** Where each field of a post lands on its card. */
const GHOSTS = [
  { field: "Cover image", hint: "Upload one in the post's Cover field. It fills the top of the card.", shape: "cover" },
  { field: "Title", hint: "The post's title, in large type. Required.", shape: "title" },
  { field: "Excerpt", hint: "A sentence or two under the title. Optional, but it helps readers pick.", shape: "excerpt" },
  { field: "Category", hint: "News, Guide or Release, shown as a colored label.", shape: "chip" },
] as const;

function Onboarding({ setup }: { setup: Setup }) {
  const steps = setupSteps(setup);
  const current = steps.findIndex((s) => !s.done);
  return (
    <div className="ti-grid ti-grid--empty">
      <section className="ti-start" aria-labelledby="ti-start-title">
        <p className="ti-start__eyebrow">Start here</p>
        <h2 id="ti-start-title" className="ti-start__title">Your first post goes on this page.</h2>
        <ol className="ti-checks">
          {steps.map((step, i) => (
            <li key={step.title} className="ti-check" data-state={step.done ? "done" : i === current ? "current" : "todo"}>
              <span className="ti-check__box" aria-hidden="true">{step.done ? "✓" : ""}</span>
              <span>
                <span className="ti-check__title">{step.title}<span className="sr-only">{step.done ? " (done)" : ""}</span></span>
                <span className="ti-check__detail">{step.detail}</span>
              </span>
            </li>
          ))}
        </ol>
        {steps[current]?.href ? <Link href={steps[current].href!} className="ti-button">{steps[current].action}</Link> : null}
      </section>
      {GHOSTS.map((g) => (
        <div key={g.field} className="ti-ghost" data-shape={g.shape}>
          <div className="ti-ghost__art" aria-hidden="true">
            <span className="ti-ghost__cover" /><span className="ti-ghost__chip" /><span className="ti-ghost__title" /><span className="ti-ghost__line" /><span className="ti-ghost__line ti-ghost__line--short" />
          </div>
          <p className="ti-ghost__field">{g.field}</p>
          <p className="ti-ghost__hint">{g.hint}</p>
        </div>
      ))}
      <figure className="ti-code">
        <figcaption>src/app/page.tsx</figcaption>
        <pre><code>{QUERY_SNIPPET}</code></pre>
      </figure>
    </div>
  );
}

export function Home({ posts, setup }: { posts: PostCard[]; setup: Setup }) {
  return (
    <div className="sv-tiles">
      <Top />
      <main className="ti-main">
        <section className="ti-intro">
          <h1>{SITE_NAME}</h1>
          <p>Edit this description in <code>src/app/page.tsx</code>.</p>
        </section>
        {posts.length === 0 ? <Onboarding setup={setup} /> : (
          <div className="ti-grid">
            {posts.map(({ post, cover }, i) => (
              <article key={post.id} className={i === 0 ? "ti-card ti-card--lead" : "ti-card"} data-cover={cover ? "yes" : "no"}>
                <Link href={postHref(post)} className="ti-card__link">
                  {cover ? <img className="ti-card__img" src={cover.url} alt={cover.alt} loading={i === 0 ? undefined : "lazy"} /> : null}
                  <span className="ti-card__body">
                    <span className="ti-card__meta"><Chip category={post.category} /><time dateTime={post.createdAt}>{formatDate(post.createdAt)}</time></span>
                    <span className="ti-card__title">{post.title}</span>
                    {post.excerpt ? <span className="ti-card__excerpt">{post.excerpt}</span> : null}
                  </span>
                </Link>
              </article>
            ))}
            <Link href={NEW_POST_HREF} className="ti-card ti-card--new">
              <span className="ti-card--new__plus" aria-hidden="true">+</span>
              Write a post
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}

export function Article({ card: { post, cover } }: { card: PostCard }) {
  return (
    <div className="sv-tiles">
      <Top />
      <main className="ti-main ti-main--article">
        <article className="ti-article">
          <Link href={homeHref} className="ti-back">← All posts</Link>
          {cover ? <img className="ti-article__cover" src={cover.url} alt={cover.alt} width={cover.width ?? undefined} height={cover.height ?? undefined} /> : null}
          <div className="ti-article__head">
            <p className="ti-card__meta"><Chip category={post.category} /><time dateTime={post.createdAt}>{formatDate(post.createdAt)}</time><span>{readingMinutes(post)} min read</span></p>
            <h1>{post.title}</h1>
            {post.excerpt ? <p className="ti-article__dek">{post.excerpt}</p> : null}
          </div>
          <div className="sv-prose"><RichText value={post.body} /></div>
          <footer className="ti-article__foot"><Link href={editHref(post)} className="ti-pill">Edit this post</Link></footer>
        </article>
      </main>
    </div>
  );
}
