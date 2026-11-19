"use client";

import type React from "react";
import { useId, useMemo, useState } from "react";
import { RiAddLine, RiArticleLine, RiImageLine, RiTeamLine, RiFolder3Line } from "@remixicon/react";

// The live thing: name a collection and see both halves of Xenon answer at once,
// the config a developer writes and the admin screen an editor gets.

type FieldDef = { name: string; helper: string; column: string };

const PRESETS: Record<string, FieldDef[]> = {
  recipes: [
    { name: "title", helper: "text({ required: true })", column: "Title" },
    { name: "servings", helper: "number({ min: 1 })", column: "Servings" },
    { name: "photo", helper: 'media({ relationTo: "media" })', column: "Photo" },
    { name: "method", helper: "richText()", column: "Method" },
  ],
  "case-studies": [
    { name: "title", helper: "text({ required: true })", column: "Title" },
    { name: "client", helper: "text()", column: "Client" },
    { name: "industry", helper: 'select({ options: ["retail", "health"] })', column: "Industry" },
    { name: "story", helper: "richText()", column: "Story" },
  ],
  episodes: [
    { name: "title", helper: "text({ required: true })", column: "Title" },
    { name: "number", helper: "number({ integer: true })", column: "Number" },
    { name: "audio", helper: 'media({ relationTo: "media" })', column: "Audio" },
    { name: "notes", helper: "richText()", column: "Notes" },
  ],
  products: [
    { name: "name", helper: "text({ required: true })", column: "Name" },
    { name: "price", helper: "number({ min: 0 })", column: "Price" },
    { name: "inStock", helper: "boolean()", column: "In stock" },
    { name: "details", helper: "richText()", column: "Details" },
  ],
};
const GENERIC: FieldDef[] = [
  { name: "title", helper: "text({ required: true })", column: "Title" },
  { name: "summary", helper: "textarea()", column: "Summary" },
  { name: "body", helper: "richText()", column: "Body" },
];

const EXAMPLES = ["Case studies", "Episodes", "Products"];

function slugify(label: string) {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "items"
  );
}

function singular(label: string) {
  const w = label.trim() || "Items";
  if (/ies$/i.test(w)) return w.replace(/ies$/i, "y");
  if (/(ss|us)$/i.test(w)) return w;
  if (/s$/i.test(w)) return w.slice(0, -1);
  return w;
}

function camel(slug: string) {
  return slug.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase()).replace(/^[0-9]/, "_$&");
}

export function TryCollection() {
  const [label, setLabel] = useState("Recipes");
  const id = useId();
  const slug = slugify(label);
  const fields = PRESETS[slug] ?? GENERIC;
  const name = label.trim() || "Items";
  const one = singular(name);
  const variable = camel(slug);

  const config = useMemo(
    () =>
      [
        `const ${variable} = defineCollection({`,
        `  slug: "${slug}",`,
        `  admin: { useAsTitle: "${fields[0]!.name}" },`,
        `  fields: {`,
        ...fields.map((f) => `    ${f.name}: ${f.helper},`),
        `  },`,
        `});`,
      ].join("\n"),
    [variable, slug, fields],
  );

  return (
    <div className="mt-10">
      <label htmlFor={id} className="text-small text-mist">
        Collection name
      </label>
      <input
        id={id}
        data-ui
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        maxLength={28}
        className="mt-1 block w-full border-0 bg-transparent p-0 text-[clamp(48px,8vw,132px)] leading-[1.08] font-semibold tracking-[-0.04em] text-glow caret-paper outline-none focus-visible:underline focus-visible:decoration-glow/40 focus-visible:decoration-4 focus-visible:underline-offset-[0.14em] max-md:text-[11vw]"
      />
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="text-mist">Or try</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setLabel(ex)}
            aria-pressed={label === ex}
            className="cursor-pointer py-1.5 text-paper underline decoration-mist/50 underline-offset-[5px] transition-colors hover:decoration-glow aria-pressed:text-glow aria-pressed:decoration-glow max-md:bg-coal max-md:px-4 max-md:py-3 max-md:no-underline"
          >
            {ex}
          </button>
        ))}
      </div>

      <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-12">
        <figure className="flex flex-col lg:col-span-5">
          <figcaption className="mb-3 text-small text-mist">You write this</figcaption>
          <pre className="flex-1 overflow-x-auto bg-coal p-6 text-[14px] leading-[1.7] text-paper max-md:p-5 max-md:text-[12.5px]">
            <code>{config}</code>
          </pre>
        </figure>

        <figure className="lg:col-span-7">
          <figcaption className="mb-3 text-small text-mist">Your editors get this</figcaption>
          {/* The admin, in the same dark surfaces and square language as the hero demo */}
          <div
            data-ui
            aria-label={`Admin screen for ${name}`}
            className="grid min-h-[340px] grid-cols-[188px_minmax(0,1fr)] rounded-[4px] bg-[#17181b] text-[13.5px] text-paper shadow-[0_0_0_1px_rgb(255_255_255/0.08)] max-md:grid-cols-1"
          >
            <aside className="flex flex-col gap-0.5 px-3 py-2.5 max-md:hidden">
              <div className="px-2 pt-3 pb-1.5 text-[12.5px] text-mist">Content</div>
              <SideItem icon={<RiArticleLine size={16} />}>Posts</SideItem>
              <SideItem icon={<RiFolder3Line size={16} />} on>
                {name}
              </SideItem>
              <SideItem icon={<RiImageLine size={16} />}>Media</SideItem>
              <div className="px-2 pt-3 pb-1.5 text-[12.5px] text-mist">Admin</div>
              <SideItem icon={<RiTeamLine size={16} />}>Team</SideItem>
            </aside>
            <div className="flex flex-col overflow-hidden border-l border-white/[0.08] bg-[#1b1d20] max-md:border-l-0">
              <div className="flex items-center justify-between gap-4 px-5 py-[18px]">
                <div className="truncate text-[18px] font-semibold tracking-[-0.01em]">{name}</div>
                <span className="inline-flex h-8 max-w-[60%] items-center gap-1.5 rounded-[3px] bg-paper pr-3 pl-2.5 text-[13px] font-medium text-ink">
                  <RiAddLine size={16} className="shrink-0" />
                  <span className="truncate">New {one.toLowerCase()}</span>
                </span>
              </div>
              <div className="px-5" role="table" aria-label={`${name} table`}>
                <div
                  role="row"
                  className="grid grid-cols-[2fr_1fr_1fr_96px] gap-3 border-b border-white/[0.08] py-2.5 text-[12.5px] font-medium text-mist max-md:grid-cols-[2fr_1fr_80px] [&>:nth-child(3)]:max-md:hidden" // taste-skill-ignore: data-ui table header
                >
                  {fields.slice(0, 3).map((f) => (
                    <span key={f.name} role="columnheader">
                      {f.column}
                    </span>
                  ))}
                  <span role="columnheader">Status</span>
                </div>
              </div>
              <div className="grid flex-1 place-content-center gap-1.5 px-6 py-10 text-center">
                <div className="text-[15px] font-semibold">No {name.toLowerCase()} yet</div>
                <div className="max-w-[34ch] text-mist">
                  Create the first {one.toLowerCase()}. It stays a draft until you publish it.
                </div>
              </div>
            </div>
          </div>
        </figure>
      </div>
    </div>
  );
}

function SideItem({ icon, on, children }: { icon: React.ReactNode; on?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`flex h-8 min-w-0 items-center gap-2 rounded-[3px] px-2 ${on ? "bg-white/[0.07] font-medium text-paper [&>svg]:text-glow" : "text-mist [&>svg]:text-[#6f7378]"}`}
    >
      <span className="contents">{icon}</span>
      <span className="truncate">{children}</span>
    </div>
  );
}
