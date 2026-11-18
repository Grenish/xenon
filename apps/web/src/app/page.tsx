import { XenonMark } from "@/components/logo";
import { TryCollection } from "@/components/try-collection";
import { EditorStudio } from "@/components/editor-studio";
import { CopyCommand, InstallDialog } from "@/components/install";
import { Motion } from "@/components/motion";
import { HeroDemo, TypesDemo } from "@/demos/client";

const GITHUB = "https://github.com/Grenish/xenon";
const DOCS = "https://github.com/Grenish/xenon/tree/main/packages/xenon#readme";

const STACK: { group: string; rows: [string, string][] }[] = [
  {
    group: "Database",
    rows: [
      ["PostgreSQL", "any server, via postgres-js"],
      ["PGlite", "embedded, zero setup"],
      ["Your own Drizzle instance", "bring it along"],
    ],
  },
  {
    group: "Files",
    rows: [
      ["Local disk", "served by the REST handler"],
      ["Amazon S3", "signed with aws4fetch"],
      ["Cloudflare R2", "S3-compatible"],
    ],
  },
  {
    group: "People",
    rows: [
      ["BetterAuth", "email and password"],
      ["Roles", "admin, editor"],
      ["API keys", "for scripts and servers"],
    ],
  },
  {
    group: "Delivery",
    rows: [
      ["Local API", "no HTTP hop"],
      ["REST", "/api/xenon"],
      ["RichText", "zero client JavaScript"],
      ["Cache tags", "expired on every publish"],
    ],
  },
];

const LOCAL_API = `const xenon = getXenon(config);

const { docs } = await xenon.find({
  collection: "posts",
  where: { category: { equals: "guide" } },
  sort: "-createdAt",
});`;

export default function Home() {
  return (
    <>
      <Motion />
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="nav wrap">
        <a className="nav-brand" href="/" aria-label="Xenon home">
          <XenonMark className="nav-mark" />
          <span>Xenon</span>
        </a>
        <nav className="nav-links" aria-label="Main">
          <a href="#editors">Editors</a>
          <a href="#developers">Developers</a>
          <a href={DOCS}>Docs</a>
          <a href={GITHUB}>GitHub</a>
        </nav>
        <a className="btn btn--dark nav-cta" href="#start">
          Get started
        </a>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="hero" aria-labelledby="hero-title">
          <div className="wrap hero-copy">
            <h1 id="hero-title" className="display">
              <span className="line">
                <span>The CMS inside</span>
              </span>{" "}
              <span className="line">
                <span>your Next.js app</span>
              </span>
            </h1>
            <div className="hero-side">
              <p className="hero-lede">
                Xenon is an open-source, code-first alternative to Payload and Sanity. Developers describe content in
                TypeScript; editors get a calm admin at <span className="nowrap">/admin</span>. It all runs in your app, on
                your Postgres.
              </p>
              <div className="hero-actions">
                <a className="btn btn--primary" href="#start">
                  Get started
                </a>
                <CopyCommand text="bun add xenon-cms" />
              </div>
            </div>
          </div>
          <div className="hero-demo" data-ui>
            <HeroDemo />
          </div>
        </section>

        {/* The live thing */}
        <section className="section try-section wrap" aria-labelledby="try-title" data-rise-group>
          <h2 id="try-title" className="h2" data-rise>
            Name a collection. Get its admin.
          </h2>
          <p className="lede try-lede" data-rise>
            One object in your config is the whole contract: the database shape, the TypeScript types, the REST routes and
            the editing screen all come from it.
          </p>
          <div data-rise>
            <TryCollection />
          </div>
        </section>

        {/* For editors */}
        <section id="editors" className="section-flush" aria-labelledby="editors-title">
          <EditorStudio />
        </section>

        {/* One post, four moments */}
        <section className="strip" aria-labelledby="flow-title" data-rise-group>
          <div className="strip-field" data-tone="1">
            <h2 id="flow-title" className="strip-heading">
              One post, start to finish
            </h2>
            <div className="doc-card" data-ui data-rise>
              <div className="doc-top">
                <span className="doc-pill" data-tone="draft">
                  Draft
                </span>
                <span className="doc-time">2 min ago</span>
              </div>
              <div className="doc-title">Designing for slow mornings</div>
              <div className="doc-meta">
                <span className="avatar" data-p="m">
                  ML
                </span>
                Maya Lind is writing
              </div>
            </div>
            <p className="strip-clause">First it&rsquo;s a draft only your team can see.</p>
          </div>

          <div className="strip-field" data-tone="2">
            <div className="doc-card" data-ui data-rise>
              <div className="doc-top">
                <span className="doc-pill" data-tone="draft">
                  Draft
                </span>
                <span className="facepile">
                  <span className="avatar" data-p="m">
                    ML
                  </span>
                  <span className="avatar" data-p="i">
                    IA
                  </span>
                </span>
              </div>
              <div className="doc-title">Designing for slow mornings</div>
              <div className="doc-lock">
                <span>Maya is editing. You&rsquo;re viewing.</span>
                <span className="doc-link">Take over</span>
              </div>
            </div>
            <p className="strip-clause">Then a teammate looks in without overwriting a word.</p>
          </div>

          <div className="strip-field" data-tone="3">
            <div className="doc-card" data-ui data-rise>
              <div className="doc-top">
                <span className="doc-pill" data-tone="live">
                  Published
                </span>
                <span className="doc-time">9:42</span>
              </div>
              <div className="doc-title">Designing for slow mornings</div>
              <div className="doc-meta">
                <span className="avatar" data-p="i">
                  IA
                </span>
                Ines Alves published it
              </div>
            </div>
            <p className="strip-clause">Publish when it&rsquo;s right, not when a deploy is.</p>
          </div>

          <div className="strip-field" data-tone="4">
            <div className="doc-card" data-ui data-rise>
              <div className="doc-top">
                <span className="doc-pill" data-tone="live">
                  Cache updated
                </span>
                <span className="doc-time">9:42</span>
              </div>
              <ul className="doc-tags">
                <li>
                  <code>xenon:posts</code>
                  <span>expired</span>
                </li>
                <li>
                  <code>xenon:posts:8f2c</code>
                  <span>expired</span>
                </li>
                <li>
                  <code>/blog</code>
                  <span>fresh on next visit</span>
                </li>
              </ul>
            </div>
            <p className="strip-clause">The site picks it up without a rebuild.</p>
          </div>
        </section>

        {/* For developers */}
        <section id="developers" className="section dev wrap" aria-labelledby="dev-title" data-rise-group>
          <div className="dev-copy">
            <h2 id="dev-title" className="h2" data-rise>
              Types that follow your schema
            </h2>
            <p className="lede" data-rise>
              Add a field and every query, form and response knows about it. The Local API reads Postgres straight from a
              Server Component: no HTTP hop, no client to configure, no codegen step.
            </p>
            <pre className="snippet" data-rise>
              <code>{LOCAL_API}</code>
            </pre>
          </div>
          <div className="dev-demo" data-rise data-ui>
            <TypesDemo />
          </div>
        </section>

        {/* What it runs on */}
        <section className="section stack wrap" aria-labelledby="stack-title" data-rise-group>
          <div className="stack-intro">
            <h2 id="stack-title" className="h2" data-rise>
              Runs on what you already own
            </h2>
            <p className="lede" data-rise>
              Like Payload, Xenon is code-first and lives inside your Next.js app. Like Sanity, it gives editors a focused
              studio. Unlike a hosted content lake, every document sits in your Postgres and every file in your bucket.
            </p>
            <p className="stack-note" data-rise>
              MIT licensed. No account, no seat pricing, no usage limits but your own server&rsquo;s.
            </p>
          </div>
          <div className="stack-list" data-rise>
            {STACK.map((g) => (
              <div key={g.group} className="stack-group">
                <h3 className="stack-group-name">{g.group}</h3>
                <ul>
                  {g.rows.map(([name, value]) => (
                    <li key={name}>
                      <span className="stack-dot" aria-hidden />
                      <span className="stack-name">{name}</span>
                      <span className="stack-value">{value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Close */}
        <section id="start" className="cta" aria-labelledby="cta-title" data-rise-group>
          <div className="wrap cta-grid">
            <div className="cta-copy">
              <h2 id="cta-title" className="cta-title" data-rise>
                Add it to your app
              </h2>
              <p data-rise>
                Install the package, write one config file and mount two routes. Open /admin, create the first account, and
                invite your editors from Team.
              </p>
              <a className="cta-link" href={DOCS} data-rise>
                Read the setup guide
              </a>
            </div>
            <div className="cta-dialog" data-rise>
              <InstallDialog />
            </div>
          </div>
        </section>
      </main>

      <footer className="footer" aria-label="Footer">
        <div className="tile tile-statement">
          <p>An open-source headless CMS that lives inside your Next.js app.</p>
          <small>MIT licensed · version 0.0.1 · Cover photographs from Unsplash</small>
        </div>
        <nav className="tile tile-nav" aria-label="Footer">
          <a href={DOCS}>Documentation</a>
          <a href={GITHUB}>Source on GitHub</a>
          <a href={`${GITHUB}/issues`}>Report an issue</a>
          <a href="https://www.npmjs.com/package/xenon-cms">npm package</a>
        </nav>
        <div className="tile tile-req">
          <p>Requires</p>
          <ul>
            <li>Next.js 16+</li>
            <li>React 19+</li>
            <li>PostgreSQL or PGlite</li>
          </ul>
        </div>
        <a className="tile tile-mark" href="/" aria-label="Xenon">
          <XenonMark className="footer-mark" />
        </a>
        <a className="tile tile-go" href={GITHUB}>
          <span>Star Xenon on GitHub</span>
          <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden>
            <path d="M10 38 38 10M16 10h22v22" fill="none" stroke="currentColor" strokeWidth="4" />
          </svg>
        </a>
      </footer>
    </>
  );
}
