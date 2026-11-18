"use client";

import type React from "react";

import type { Act } from "@/stageshow/kit/act";
import { Code } from "@/stageshow/kit/code";
import { Popover } from "@/stageshow/kit/motion/Popover";
import { Menu } from "@/stageshow/kit/parts/Menu";
import { Stage } from "@/stageshow/kit/stage";
import { Window } from "@/stageshow/kit/window";
import { RiText, RiToggleLine, RiListCheck, RiImageLine } from "@remixicon/react";
import "./types-demo.css";

// Developers: the Local API is typed from the schema. In a Server Component the
// developer types `post.` and the editor lists the fields of the posts
// collection, with their inferred types; `featured` is the field added in the
// hero, so the two demos tell one story. They pick `title`, and the line is done.

type S = { typed: string; caret: boolean; menu: boolean; pick: number };

const initial: S = { typed: "", caret: false, menu: false, pick: 0 };
const POSTER: S = { typed: "post.", caret: true, menu: true, pick: 0 };

const FIELDS: [string, string][] = [
  ["title", "string"],
  ["slug", "string"],
  ["category", '"news" | "guide"'],
  ["featured", "boolean"],
  ["cover", "string | null"],
];

const SOURCE = {
  wide: {
    before: [
      'import { getXenon } from "xenon-cms/next";',
      'import config from "@/xenon.config";',
      "",
      "export default async function Blog() {",
      "  const xenon = getXenon(config);",
      '  const { docs } = await xenon.find({ collection: "posts" });',
      "  return docs.map((post) => (",
    ],
    prefix: "    <Card title={",
    suffix: "} />",
    after: ["  ));", "}"],
  },
  compact: {
    before: [
      "const { docs } = await xenon.find({",
      '  collection: "posts",',
      "});",
      "return docs.map((post) => (",
      "  <Card title={",
    ],
    prefix: "    ",
    suffix: "",
    after: ["  } />", "));"],
  },
};

const KIND: Record<string, React.ReactNode> = {
  title: <RiText size={14} />,
  slug: <RiText size={14} />,
  category: <RiListCheck size={14} />,
  featured: <RiToggleLine size={14} />,
  cover: <RiImageLine size={14} />,
};

async function script(a: Act<S>) {
  await a.wait(600);
  await a.move("line");
  await a.wait(150);
  await a.click();
  await a.set({ caret: true });
  await a.wait(300);
  await a.type("typed", "post.", { interval: 90 });
  await a.wait(250);
  await a.set({ menu: true, pick: 0 });
  await a.wait(1100);
  // Look through what the schema offers
  for (const i of [1, 2, 3]) {
    await a.key("down");
    await a.set({ pick: i });
    await a.wait(i === 2 ? 900 : 420);
  }
  for (const i of [2, 1, 0]) {
    await a.key("up");
    await a.set({ pick: i });
    await a.wait(260);
  }
  await a.wait(300);
  await a.key("enter");
  await a.set({ menu: false, typed: "post.title" });
  await a.wait(500);
  await a.set({ caret: false });
  await a.move("rest");
  await a.wait(2400);
  // Undo the completion and then the typed prefix before the next pass.
  await a.key("cmd+z");
  await a.set({ typed: "post.", caret: true });
  await a.wait(350);
  await a.key("cmd+z");
  await a.set({ ...initial });
  await a.wait(700);
}

const REST = { wide: { x: 560, y: 360 }, compact: { x: 300, y: 340 } };

export function TypesDemo() {
  return (
    <Stage
      width={660}
      height={440}
      compact={{ below: 600, width: 358, height: 380 }}
      initial={initial}
      poster={POSTER}
      script={script}
      cursor={{ at: REST, idle: 500 }}
      keys={{ wide: "bottom-right", compact: "bottom-left" }}
      accent="#1b6c80"
      greys="cool"
      className="xt"
    >
      {(s, rect, layout) => {
        const compact = layout === "compact";
        const anchor = rect("anchor");
        const source = SOURCE[layout];
        return (
          <>
            <Window title="app/blog/page.tsx" className="xt-win">
              <div className="xt-body" data-cursor="ibeam">
                <Code lines={source.before} numbers={!compact} />
                <div className="xt-edit" style={{ "--xt-prefix": `${source.prefix.length}ch` } as React.CSSProperties}>
                  <Code lines={[source.prefix + s.typed + source.suffix]} numbers={!compact} start={source.before.length + 1} />
                  <span className="xt-line" data-target="line">
                    {s.caret && <span className="xt-caret" style={{ left: `${s.typed.length}ch` }} />}
                  </span>
                  <span className="xt-anchor" data-target="anchor" />
                </div>
                <Code lines={source.after} numbers={!compact} start={source.before.length + 2} />
              </div>
            </Window>
            <Popover show={s.menu} className="xt-pop" style={{ left: anchor.x, top: anchor.y + anchor.height + 4 }}>
              <Menu
                value={s.pick}
                items={FIELDS.map(([name, type]) => (
                  <span key={name} className="xt-item">
                    <span className="xt-kind">{KIND[name]}</span>
                    <code className="xt-name">{name}</code>
                    <code className="xt-type">{type}</code>
                  </span>
                ))}
              />
            </Popover>
            <span data-target="rest" style={{ position: "absolute", left: REST[layout].x, top: REST[layout].y }} />
          </>
        );
      }}
    </Stage>
  );
}
