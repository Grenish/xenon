"use client";

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
    <div className="try">
      <label htmlFor={id} className="try-label">
        Collection name
      </label>
      <input
        id={id}
        className="try-input"
        data-ui
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        maxLength={28}
      />
      <div className="try-examples">
        <span className="try-examples-note">Or try</span>
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="try-example" onClick={() => setLabel(ex)} aria-pressed={label === ex}>
            {ex}
          </button>
        ))}
      </div>

      <div className="try-answer">
        <figure className="try-code">
          <figcaption>You write this</figcaption>
          <pre>
            <code>{config}</code>
          </pre>
        </figure>

        <figure className="try-admin">
          <figcaption>Your editors get this</figcaption>
          <div className="ui-admin" data-ui aria-label={`Admin screen for ${name}`}>
            <aside className="ui-side">
              <div className="ui-side-group">Content</div>
              <div className="ui-side-item">
                <RiArticleLine size={16} /> Posts
              </div>
              <div className="ui-side-item" data-on>
                <RiFolder3Line size={16} /> <span className="ui-trunc">{name}</span>
              </div>
              <div className="ui-side-item">
                <RiImageLine size={16} /> Media
              </div>
              <div className="ui-side-group">Admin</div>
              <div className="ui-side-item">
                <RiTeamLine size={16} /> Team
              </div>
            </aside>
            <div className="ui-sheet">
              <div className="ui-sheet-head">
                <div className="ui-sheet-title ui-trunc">{name}</div>
                <span className="ui-btn ui-btn--primary">
                  <RiAddLine size={16} /> <span className="ui-trunc">New {one.toLowerCase()}</span>
                </span>
              </div>
              <div className="ui-table" role="table">
                <div className="ui-tr ui-th" role="row">
                  {fields.slice(0, 3).map((f) => (
                    <span key={f.name} role="columnheader">
                      {f.column}
                    </span>
                  ))}
                  <span role="columnheader">Status</span>
                </div>
              </div>
              <div className="ui-empty">
                <div className="ui-empty-title">No {name.toLowerCase()} yet</div>
                <div className="ui-empty-text">
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
