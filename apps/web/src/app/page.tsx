import type React from "react";
import { XenonMark } from "@/components/logo";
import { TryCollection } from "@/components/try-collection";
import { CopyButton } from "@/components/install";
import { Slip } from "@/components/slip";
import { EditorTour } from "@/components/editor-tour";
import { Motion } from "@/components/motion";
import { Credits } from "@/components/photos";
import { HeroDemo, TypesDemo } from "@/demos/client";
import { HeroDischarge } from "@/components/hero-discharge";
import { StackField } from "@/components/stack-field";

const GITHUB = "https://github.com/Grenish/xenon";
const DOCS = "/docs";
const INSTALL = "bun add xenon-cms";

/** What editors get: one row each, a title, what it does, and the three things it covers. */
const EDITOR_ROWS: { title: string; text: string; terms: string[] }[] = [
  {
    title: "Drafts",
    text: "Save as often as you like. Nothing reaches the site until someone presses Publish.",
    terms: ["Draft", "Unpublished changes", "Published"],
  },
  {
    title: "Rich text",
    text: "A real editor for headings, lists, links and images, stored as clean JSON your site renders in one line.",
    terms: ["Headings", "Links", "Images"],
  },
  {
    title: "Media",
    text: "Upload once, pick it anywhere. Files go to your own disk, S3 or Cloudflare R2.",
    terms: ["Alt text", "Image sizes", "Library picker"],
  },
  {
    title: "Presence",
    text: "See who is in the admin and where. The first person in edits; the others watch their saves arrive.",
    terms: ["Who's online", "Soft lock", "Take over"],
  },
  {
    title: "Roles",
    text: "Admins invite the team and editors write. Everyone signs in with an email and a password.",
    terms: ["Admin", "Editor", "API keys"],
  },
];

/** The stack, as two-ended rows: the thing, and what it is to you. */
const STACK: { group: string; rows: [string, string][] }[] = [
  {
    group: "Data",
    rows: [
      ["PostgreSQL", "any server"],
      ["PGlite", "embedded, no setup"],
      ["Drizzle", "bring your own instance"],
    ],
  },
  {
    group: "Files",
    rows: [
      ["Local disk", "served by the API route"],
      ["Amazon S3", "signed requests"],
      ["Cloudflare R2", "S3-compatible"],
    ],
  },
  {
    group: "People",
    rows: [
      ["BetterAuth", "sessions you host"],
      ["Roles", "admin and editor"],
      ["API keys", "for scripts"],
    ],
  },
  {
    group: "Delivery",
    rows: [
      ["Local API", "no HTTP hop"],
      ["REST", "/api/xenon"],
      ["RichText", "no client JavaScript"],
      ["Cache tags", "expired on publish"],
    ],
  },
];

/** The slip: install to publish, grouped by the stage you're at. */
const SLIP: { stage: string; rows: [string, string][] }[] = [
  {
    stage: "Install",
    rows: [
      ["Add the package", INSTALL],
      ["Pick a database", "PGlite or Postgres"],
    ],
  },
  {
    stage: "Describe",
    rows: [
      ["Your collections", "xenon.config.ts"],
      ["Get the types", "InferCollectionType"],
    ],
  },
  {
    stage: "Mount",
    rows: [
      ["The API route", "app/api/xenon"],
      ["The admin page", "app/admin"],
    ],
  },
  {
    stage: "Publish",
    rows: [
      ["Create the first admin", "/admin"],
      ["Invite your editors", "Team"],
    ],
  },
];

/** Shared horizontal frame: one pair of margins for the whole page. */
const FRAME = "px-gutter";

export default function Home() {
  return (
    <>
      <Motion />
      <a
        className="absolute -top-20 left-gutter z-50 bg-paper px-4 py-3 text-ink focus:top-3"
        href="#main"
      >
        Skip to content
      </a>

      <div className="relative z-10 bg-void">
        {/* ---------- First screen: the statement, nothing else */}
        <header className={`relative isolate flex min-h-svh flex-col ${FRAME} pt-6 pb-8`} aria-labelledby="hero-title">
          <HeroDischarge />
          <div className="flex items-center justify-between gap-6 text-small">
            <a className="inline-flex items-center gap-2.5 font-semibold text-paper no-underline" href="/" aria-label="Xenon, home">
              <XenonMark className="h-3.5 w-auto" />
              <span className="text-body">Xenon</span>
            </a>
            <nav className="flex gap-6 max-md:hidden" aria-label="Main">
              {[
                ["Editors", "#editors"],
                ["Developers", "#developers"],
                ["Docs", DOCS],
                ["GitHub", GITHUB],
              ].map(([label, href]) => (
                <a key={label} href={href} className="text-mist no-underline transition-colors hover:text-paper">
                  {label}
                </a>
              ))}
            </nav>
            <a href={GITHUB} className="text-mist no-underline md:hidden">
              GitHub
            </a>
          </div>

          <h1 id="hero-title" className="mt-[13svh] text-display font-semibold max-md:text-[16vw] max-md:leading-[0.9]">
            <span className="mask-line">
              <span>Schema in.</span>
            </span>
            <span className="mask-line md:text-right">
              <span>Admin out.</span>
            </span>
          </h1>

          <div className="hero-after mt-auto flex items-end justify-between gap-10 pt-16 max-md:flex-col max-md:items-stretch">
            <p className="max-w-[38ch] text-statement text-paper">
              An open-source CMS for Next.js. Content described in TypeScript, a calm admin for editors, all on your own
              Postgres.
            </p>
            <a className="btn btn--paper" href="#start">
              Get started
            </a>
          </div>
        </header>

        <main id="main">
          {/* ---------- The product, doing it, on the hero's own ground */}
          <section className={`${FRAME} pt-10`} aria-labelledby="band-title">
            <h2 id="band-title" className="sr-only">
              Xenon at work
            </h2>
            <div className="band-demo max-w-[1500px]" data-ui>
              <HeroDemo />
            </div>
          </section>

          {/* ---------- The live thing */}
          <section className={`${FRAME} pt-section`} aria-labelledby="try-title" data-rise-group>
            <h2 id="try-title" className="text-h2 font-semibold" data-rise>
              Name a collection.
            </h2>
            <div data-rise>
              <TryCollection />
            </div>
          </section>

          {/* ---------- Editors: the paper side, as a tour of what they get */}
          <EditorTour rows={EDITOR_ROWS} />

          {/* ---------- Developers */}
          <section
            id="developers"
            className={`${FRAME} mt-section grid grid-cols-[minmax(0,1fr)] items-center gap-x-12 gap-y-10 lg:grid-cols-12`}
            aria-labelledby="dev-title"
            data-rise-group
          >
            <div className="flex flex-col gap-6 lg:col-span-5">
              <h2 id="dev-title" className="text-h2 font-semibold" data-rise>
                Types that follow the schema
              </h2>
              <p className="max-w-[30ch] text-statement" data-rise>
                Add a field and every query, form and response knows about it. No codegen, no client to configure.
              </p>
              <pre className="overflow-x-auto bg-coal p-6 text-[14px] leading-relaxed text-paper max-md:text-[12.5px]" data-rise>
                <code>{`const { docs } = await getXenon(config).find({
  collection: "posts",
  where: { featured: { equals: true } },
});`}</code>
              </pre>
            </div>
            <div className="dev-demo lg:col-span-7" data-rise data-ui>
              <TypesDemo />
            </div>
          </section>

          {/* ---------- The slip, on the xenon field */}
          <section className="mt-section bg-glow text-glow-ink" aria-labelledby="slip-title" data-rise-group>
            <div className={`${FRAME} grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-12 py-section lg:grid-cols-12`}>
              <div className="flex flex-col gap-6 lg:col-span-5">
                <h2 id="slip-title" className="text-h2 font-semibold" data-rise>
                  Install to publish
                </h2>
                <p className="max-w-[28ch] text-statement" data-rise>
                  One package, one config file and two routes. There&rsquo;s no service to sign up for and no second server
                  to run.
                </p>
                <div className="mt-4" data-rise>
                  <CopyButton text={INSTALL} tone="ink" />
                </div>
              </div>
              <div className="lg:col-span-5 lg:col-start-7">
                <Slip stages={SLIP} version="v0.0.1" />
              </div>
            </div>
          </section>

          {/* ---------- What it runs on */}
          <section
            className={`${FRAME} relative isolate mt-section grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-14 py-24 lg:grid-cols-12`}
            aria-labelledby="stack-title"
            data-rise-group
            data-stack-section
          >
            <StackField />
            <div className="w-full max-w-[560px] lg:col-span-5 lg:col-start-2">
              <h2 id="stack-title" className="text-statement font-semibold" data-rise>
                Runs on what you own
              </h2>
              {/* Each row drives the Xe beside it: the shader reads data-stack-group and data-stack-index */}
              <div className="stack-list">
                {STACK.map((g, gi) => (
                  <div key={g.group} className="mt-10" data-rise>
                    <h3 className="text-mist">{g.group}</h3>
                    <ul className="mt-1">
                      {g.rows.map(([name, value], ri) => (
                        <li
                          key={name}
                          tabIndex={0}
                          data-stack-row
                          data-stack-group={g.group.toLowerCase()}
                          data-stack-index={STACK.slice(0, gi).reduce((n, x) => n + x.rows.length, 0) + ri}
                          className="stack-row grid min-h-[38px] grid-cols-[16px_1fr_auto] items-center gap-x-2 max-md:min-h-11"
                        >
                          <span className="stack-dot size-2.5 rounded-full bg-glow" aria-hidden />
                          <span>{name}</span>
                          <span className="stack-value text-right text-small text-mist">{value}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="mt-12 max-w-[44ch] text-mist" data-rise>
                Like Payload, it lives in your Next.js app. Like Sanity, editors get a focused studio. Unlike a hosted
                content lake, every document stays in your database. MIT licensed.
              </p>
            </div>
          </section>

          {/* ---------- Close: the page inverted */}
          <section
            id="start"
            className={`${FRAME} mt-section flex min-h-[90svh] flex-col bg-sheet pt-[12svh] pb-10 text-ink max-md:min-h-[80svh]`}
            aria-labelledby="close-title"
            data-rise-group
          >
            <h2 id="close-title" className="text-display font-semibold max-md:text-[15vw] max-md:leading-[0.9]" data-rise>
              <span className="block">Your schema.</span>
              <span className="block">Your admin.</span>
            </h2>
            <div className="mt-auto flex items-end justify-between gap-10 pt-16 max-md:flex-col max-md:items-stretch">
              <p className="max-w-[36ch] text-statement" data-rise>
                Needs Next.js 16 and React 19. Then open your app&rsquo;s admin page and create the first account.
              </p>
              <CopyButton text={INSTALL} />
            </div>
          </section>
        </main>
      </div>

      {/* ---------- Footer, uncovered as the page slides away */}
      <footer className={`sticky bottom-0 z-0 grid min-h-svh grid-rows-[auto_1fr_auto] ${FRAME} pt-10 pb-5`}>
        <div className="grid grid-cols-2 gap-x-8 gap-y-8 md:grid-cols-4">
          <FooterCol lead="Product">
            <a href={DOCS}>Documentation</a>
            <a href={GITHUB}>Source on GitHub</a>
          </FooterCol>
          <FooterCol lead="Requires">
            <span>Next.js 16+</span>
            <span>React 19+</span>
            <span>PostgreSQL or PGlite</span>
          </FooterCol>
          <FooterCol lead="Licence">
            <span>MIT</span>
            <span>Version 0.0.1</span>
            <a href={`${GITHUB}/issues`}>Report an issue</a>
          </FooterCol>
          <FooterCol lead="Named for">
            <span>Xenon, element 54</span>
            <span>A noble gas</span>
            <span>Atomic mass 131.293</span>
          </FooterCol>
        </div>
        <div />
        <div>
          <XenonMark className="block h-auto w-full text-paper" title="Xenon" />
          <Credits />
        </div>
      </footer>
    </>
  );
}

function FooterCol({ lead, children }: { lead: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-mist [&_a]:no-underline [&_a]:transition-colors [&_a:hover]:text-paper">
      <p className="text-paper">{lead}</p>
      {children}
    </div>
  );
}
