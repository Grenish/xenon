/**
 * B · Glow — xenon is element 54: in a discharge lamp it glows a pale blue-violet.
 * Signature: onboarding progress as a three-segment discharge tube that lights up as steps are done.
 */
import Link from "next/link";
import { RichText } from "xenon-cms/react";
import {
  CATEGORY_LABEL, NEW_POST_HREF, QUERY_SNIPPET, SITE_NAME, editHref, formatDate, homeHref, postHref, readingMinutes, setupSteps,
  type PostCard, type Setup,
} from "../data";

function Top() {
  return (
    <header className="gl-top">
      <Link href={homeHref} className="gl-brand"><span className="gl-brand__dot" aria-hidden="true" />{SITE_NAME}</Link>
      <Link href="/admin" className="gl-top__admin">Admin</Link>
    </header>
  );
}

function Onboarding({ setup }: { setup: Setup }) {
  const steps = setupSteps(setup);
  const current = steps.findIndex((s) => !s.done);
  const done = steps.filter((s) => s.done).length;
  return (
    <section className="gl-onboard" aria-labelledby="gl-onboard-title">
      <h1 id="gl-onboard-title" className="gl-onboard__title">Your site is ready for its first post.</h1>
      <div className="gl-tube" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
        {steps.map((step, i) => (
          <span key={step.title} className="gl-tube__seg" data-state={step.done ? "done" : i === current ? "current" : "todo"} />
        ))}
      </div>
      <ol className="gl-steps">
        {steps.map((step, i) => (
          <li key={step.title} className="gl-step" data-state={step.done ? "done" : i === current ? "current" : "todo"}>
            <p className="gl-step__label">{step.done ? "Done" : i === current ? "Next" : "Later"}</p>
            <p className="gl-step__title">{step.title}</p>
            <p className="gl-step__detail">{step.detail}</p>
            {i === current && step.href ? <Link href={step.href} className="gl-button">{step.action}</Link> : null}
          </li>
        ))}
      </ol>
      <figure className="gl-code">
        <figcaption>src/app/page.tsx</figcaption>
        <pre><code>{QUERY_SNIPPET}</code></pre>
      </figure>
    </section>
  );
}

export function Home({ posts, setup }: { posts: PostCard[]; setup: Setup }) {
  return (
    <div className="sv-glow">
      <div className="gl-line" aria-hidden="true" />
      <Top />
      <main className="gl-main">
        {posts.length === 0 ? <Onboarding setup={setup} /> : (
          <>
            <section className="gl-intro">
              <h1>{SITE_NAME}</h1>
              <p>Edit this description in <code>src/app/page.tsx</code>.</p>
            </section>
            <ul className="gl-list">
              {posts.map(({ post, cover }) => (
                <li key={post.id}>
                  <Link href={postHref(post)} className="gl-row">
                    <span className="gl-row__meta">
                      <time dateTime={post.createdAt}>{formatDate(post.createdAt)}</time>
                      <span>{CATEGORY_LABEL[post.category ?? ""] ?? "Post"}</span>
                    </span>
                    <span className="gl-row__text">
                      <span className="gl-row__title">{post.title}</span>
                      {post.excerpt ? <span className="gl-row__excerpt">{post.excerpt}</span> : null}
                    </span>
                    {cover ? <img className="gl-row__thumb" src={cover.url} alt="" loading="lazy" /> : <span aria-hidden="true" />}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="gl-foot">
              Posts come from the Local API in <code>src/app/page.tsx</code>. <Link href={NEW_POST_HREF}>Write a post</Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}

export function Article({ card: { post, cover } }: { card: PostCard }) {
  return (
    <div className="sv-glow">
      <div className="gl-line" aria-hidden="true" />
      <Top />
      <main className="gl-main gl-main--article">
        <article className="gl-article">
          <Link href={homeHref} className="gl-back">← All posts</Link>
          <p className="gl-article__meta">
            <span>{CATEGORY_LABEL[post.category ?? ""] ?? "Post"}</span>
            <time dateTime={post.createdAt}>{formatDate(post.createdAt)}</time>
            <span>{readingMinutes(post)} min read</span>
          </p>
          <h1>{post.title}</h1>
          {post.excerpt ? <p className="gl-article__dek">{post.excerpt}</p> : null}
          {cover ? <img className="gl-article__cover" src={cover.url} alt={cover.alt} width={cover.width ?? undefined} height={cover.height ?? undefined} /> : null}
          <div className="sv-prose"><RichText value={post.body} /></div>
          <footer className="gl-article__foot"><Link href={editHref(post)} className="gl-button gl-button--quiet">Edit this post</Link></footer>
        </article>
      </main>
    </div>
  );
}
