"use client";

import { Badge, Button, Code, Collapse, Roll, Stage, Toast, Toggle, Window, Bar, Icon, type Act, type CodeLine } from "@/stageshow/kit-lite";
import { XenonMark } from "@/components/logo";
import "./hero-demo.css";

// The hero: one schema, two audiences. A developer adds `featured: boolean()`
// to xenon.config.ts and saves; the post's admin grows a "Featured" switch;
// the editor turns it on and publishes; a toast confirms the site updated.
//
// Real strings: the config lines, the post title, Category/Guide, Featured,
// the status pill, Publish, the toast. Everything else is filler.

type Status = "live" | "changed";
type S = {
  line: boolean;
  typed: string;
  typing: boolean;
  saved: boolean;
  field: boolean;
  on: boolean;
  status: Status;
  publishing: boolean;
  toast: boolean;
};

const initial: S = { line: false, typed: "", typing: false, saved: true, field: false, on: false, status: "live", publishing: false, toast: false };
const FIELD = "featured: boolean(),";
const POSTER: S = { line: true, typed: FIELD, typing: false, saved: true, field: true, on: true, status: "live", publishing: false, toast: true };

const BASE: string[] = [
  "const posts = defineCollection({",
  '  slug: "posts",',
  '  slugFrom: "title",',
  "  fields: {",
  "    title: text({ required: true }),",
  "    category: select({ options }),",
  '    cover: media({ relationTo: "media" }),',
  "    body: richText(),",
];
const TAIL = ["  },", "});", "", "const media = defineCollection({", '  slug: "media",', "  upload: true,", "  fields: {"];

function blocks(s: S, compact: boolean) {
  const head = compact ? BASE.filter((t) => t.includes("category") || t.includes("body")) : BASE;
  const tail = compact ? TAIL.slice(0, 1) : TAIL;
  const firstNo = compact ? 6 : 1;
  // The caret keeps its one-character slot when it goes, so the line never changes width
  const added: CodeLine = { text: `    ${s.typed}${s.typing ? "▏" : " "}`, kind: "add" };
  return { head, tail, added, firstNo, tailNo: firstNo + head.length + (s.line ? 1 : 0) };
}

const REST = { wide: { x: 410, y: 300 }, compact: { x: 290, y: 170 } };

async function script(a: Act<S>) {
  await a.wait(700);
  // The developer adds a field
  await a.move("eol");
  await a.wait(200);
  await a.click();
  await a.set({ line: true, typing: true, saved: false });
  await a.wait(250);
  await a.type("typed", FIELD, { interval: 55 });
  await a.wait(300);
  await a.key("cmd+s");
  await a.set({ saved: true, typing: false });
  await a.wait(350);
  // The admin grows the field it describes
  await a.set({ field: true });
  await a.wait(900);
  // The editor uses it
  await a.move("featured");
  await a.wait(200);
  await a.click();
  await a.set({ on: true, status: "changed" });
  await a.wait(700);
  await a.move({ at: "publish", x: 0.82, y: 0.78 });
  await a.wait(150);
  await a.click();
  await a.set({ publishing: true });
  await a.wait(500);
  await a.set({ publishing: false, status: "live", toast: true });
  await a.move("rest");
  await a.wait(2600);
  // Close the toast, then put the file back the way it was
  await a.set({ toast: false });
  await a.wait(500);
  await a.set({ field: false, on: false });
  await a.wait(450);
  await a.set({ ...initial });
  await a.wait(500);
}

export function HeroDemo() {
  return (
    <Stage
      width={1100}
      height={500}
      compact={{ below: 760, width: 358, height: 334 }}
      initial={initial}
      poster={POSTER}
      script={script}
      cursor={{ at: REST }}
      accent="#1b6c80"
      greys="cool"
      className="xh"
    >
      {(s, _rect, layout) => {
        const compact = layout === "compact";
        const b = blocks(s, compact);
        return (
          <>
            <Window
              className="xh-admin"
              title="Posts"
              sidebar={compact ? undefined : <Sidebar />}
              sidebarWidth={168}
              toolbar={
                <div className="xh-actions">
                  <Badge tone={s.status === "live" ? "success" : "warning"} dot className="xh-status">
                    <Roll variant="fade">{s.status === "live" ? "Published" : "Changed"}</Roll>
                  </Badge>
                  <Button variant="primary" data-target="publish" data-cursor="pointer" className="xh-publish">
                    Publish
                  </Button>
                </div>
              }
              data-cursor="pointer"
            >
              <div className="xh-doc">
                {!compact && (
                  <div className="xh-main">
                    <div className="xh-title">Designing for slow mornings</div>
                    <div className="xh-lines">
                      <Bar w="94%" h={6} tone={2} />
                      <Bar w="86%" h={6} tone={2} />
                      <Bar w="70%" h={6} tone={2} />
                    </div>
                    <img className="xh-cover" src="/img/p1081.jpg" alt="" width={1600} height={1000} />
                  </div>
                )}
                <div className="xh-fields">
                  <div className="xh-field">
                    <div className="xh-label">Category</div>
                    <div className="xh-select">
                      <span>Guide</span>
                      <Icon name="chevron-down" size={14} />
                    </div>
                  </div>
                  <Collapse open={s.field} reveal="drop">
                    <div className="xh-switch-wrap"><div className="xh-switch">
                      <div className="xh-label">Featured</div>
                      <Toggle on={s.on} data-target="featured" data-cursor="pointer" />
                    </div></div>
                  </Collapse>
                  <div className="xh-field">
                    <div className="xh-label">Slug</div>
                    <div className="xh-input">designing-for-slow-mornings</div>
                  </div>
                </div>
                <div className="xh-toast-slot" hidden={compact}>
                  <Toast show={s.toast} icon={<Icon name="check" size={14} />}>
                    Published · /blog updated
                  </Toast>
                </div>
              </div>
            </Window>

            <Window title="xenon.config.ts" className="xh-code" toolbar={<span className="xh-dirty" data-on={!s.saved || undefined} aria-hidden />}>
              <div className="xh-code-body" data-cursor="ibeam">
                <Code lines={b.head} start={b.firstNo} numbers={!compact} />
                <Collapse open={s.line}>
                  <Code lines={[b.added]} start={b.firstNo + b.head.length} numbers={!compact} highlight={false} />
                </Collapse>
                <Code lines={b.tail} start={b.tailNo} numbers={!compact} />
                <span className="xh-eol" data-target="eol" />
              </div>
            </Window>
            <span data-target="rest" style={{ position: "absolute", left: REST[layout].x, top: REST[layout].y }} />
          </>
        );
      }}
    </Stage>
  );
}

function Sidebar() {
  return (
    <div className="xh-side">
      <div className="xh-brand">
        <XenonMark className="xh-mark" />
      </div>
      <div className="xh-nav">
        <div className="xh-nav-item" data-on>
          Posts
        </div>
        <div className="xh-nav-item">Media</div>
        <div className="xh-nav-item">
          <Bar w={46} h={6} tone={3} />
        </div>
        <div className="xh-nav-item">
          <Bar w={38} h={6} tone={3} />
        </div>
      </div>
    </div>
  );
}
