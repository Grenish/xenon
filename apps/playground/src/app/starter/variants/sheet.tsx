/**
 * A · Sheet — the same family as the Xenon admin: a white sheet on a frame, IBM Plex, teal.
 * Signature: a file-tab code card showing the exact query this page runs.
 */
import Link from "next/link";
import { RichText } from "xenon-cms/react";
import {
  CATEGORY_LABEL, NEW_POST_HREF, QUERY_SNIPPET, SITE_NAME, editHref, formatDate, homeHref, postHref, readingMinutes, setupSteps,
  type PostCard, type Setup,
} from "../data";

function Top() {
  return (
    <header className="sh-top">
      <Link href={homeHref} className="sh-brand">
        <span className="sh-brand__mark" aria-hidden="true" />
        {SITE_NAME}
      </Link>
      <Link href="/admin" className="sh-top__admin">Admin</Link>
    </header>
  );
}

function CodeCard({ caption }: { caption: string }) {
  return (
    <figure className="sh-code">
      <div className="sh-code__tab">src/app/page.tsx</div>
      <pre><code>{QUERY_SNIPPET}</code></pre>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function Onboarding({ setup }: { setup: Setup }) {
  const steps = setupSteps(setup);
  const current = steps.findIndex((s) => !s.done);
  return (
    <section className="sh-onboard" aria-labelledby="sh-onboard-title">
      <p className="sh-status"><span className="sh-status__dot" aria-hidden="true" />Xenon is running</p>
      <h1 id="sh-onboard-title" className="sh-onboard__title">Publish your first post.</h1>
      <p className="sh-onboard__lede">Three steps from an empty site to a published page.</p>
      <div className="sh-onboard__grid">
        <ol className="sh-steps">
          {steps.map((step, i) => (
            <li key={step.title} className="sh-step" data-state={step.done ? "done" : i === current ? "current" : "todo"}>
              <span className="sh-step__marker" aria-hidden="true">{step.done ? "✓" : i + 1}</span>
              <div>
                <p className="sh-step__title">{step.title}<span className="sr-only">{step.done ? " (done)" : ""}</span></p>
                <p className="sh-step__detail">{step.detail}</p>
                {i === current && step.href ? <Link href={step.href} className="sh-button">{step.action}</Link> : null}
              </div>
            </li>
          ))}
        </ol>
        <CodeCard caption="This page runs this query. Published posts appear here on the next visit." />
      </div>
    </section>
  );
}

export function Home({ posts, setup }: { posts: PostCard[]; setup: Setup }) {
  const [lead, ...rest] = posts;
  return (
    <div className="sv-sheet">
      <Top />
      <main className="sh-sheet">
        {!lead ? <Onboarding setup={setup} /> : (
          <>
            <section className="sh-intro">
              <h1>{SITE_NAME}</h1>
              <p>Edit this description in <code>src/app/page.tsx</code>.</p>
            </section>
            <article className="sh-lead">
              <Link href={postHref(lead.post)} className="sh-lead__link">
                {lead.cover ? <img className="sh-lead__img" src={lead.cover.url} alt={lead.cover.alt} width={lead.cover.width ?? undefined} height={lead.cover.height ?? undefined} /> : null}
                <div className="sh-lead__body">
                  <p className="sh-meta">{CATEGORY_LABEL[lead.post.category ?? ""] ?? "Post"} · {formatDate(lead.post.createdAt)}</p>
                  <h2>{lead.post.title}</h2>
                  {lead.post.excerpt ? <p className="sh-excerpt">{lead.post.excerpt}</p> : null}
                </div>
              </Link>
            </article>
            {rest.length ? (
              <ul className="sh-list">
                {rest.map(({ post, cover }) => (
                  <li key={post.id}>
                    <Link href={postHref(post)} className="sh-row">
                      <time className="sh-row__date" dateTime={post.createdAt}>{formatDate(post.createdAt)}</time>
                      <span className="sh-row__text">
                        <span className="sh-row__title">{post.title}</span>
                        {post.excerpt ? <span className="sh-row__excerpt">{post.excerpt}</span> : null}
                      </span>
                      {cover ? <img className="sh-row__thumb" src={cover.url} alt="" loading="lazy" /> : <span aria-hidden="true" />}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            <footer className="sh-foot">
              <p>Posts come from <code>getXenon(config).find()</code> in <code>src/app/page.tsx</code>.</p>
              <Link href={NEW_POST_HREF} className="sh-button sh-button--quiet">Write a post</Link>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}

export function Article({ card: { post, cover } }: { card: PostCard }) {
  return (
    <div className="sv-sheet">
      <Top />
      <main className="sh-sheet sh-sheet--article">
        <article className="sh-article">
          <Link href={homeHref} className="sh-back">← All posts</Link>
          <p className="sh-meta">{CATEGORY_LABEL[post.category ?? ""] ?? "Post"} · {formatDate(post.createdAt)} · {readingMinutes(post)} min read</p>
          <h1>{post.title}</h1>
          {post.excerpt ? <p className="sh-article__dek">{post.excerpt}</p> : null}
          {cover ? <img className="sh-article__cover" src={cover.url} alt={cover.alt} width={cover.width ?? undefined} height={cover.height ?? undefined} /> : null}
          <div className="sv-prose"><RichText value={post.body} /></div>
          <footer className="sh-article__foot">
            <Link href={editHref(post)} className="sh-button sh-button--quiet">Edit this post</Link>
          </footer>
        </article>
      </main>
    </div>
  );
}
