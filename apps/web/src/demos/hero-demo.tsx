"use client";

import { Badge, Button, Code, Collapse, Roll, Stage, Toggle, Window, Bar, Icon, type Act, type CodeLine } from "@/stageshow/kit-lite";
import { XenonMark } from "@/components/logo";
import "./hero-demo.css";

// The hero: one schema, three places. A developer adds `featured: boolean()`
// to xenon.config.ts and saves; the post's admin grows a "Featured" switch;
// the editor turns it on and publishes; the live blog, in the corner, marks
// the post Featured. Then ⌘Z takes the line back out, and the switch and the
// mark go with it: the reset has a cause.
//
// Dark, in the landing page's own tokens (void/coal/paper/mist), with one lit
// color: xenon's glow, on the new line, the switch and the site's mark.
//
// Real strings: the config lines, the post title, Category/Guide, Featured,
// the status pill, Publish, the site's address and post. The rest is filler.

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
  site: boolean;
};

const initial: S = { line: false, typed: "", typing: false, saved: true, field: false, on: false, status: "live", publishing: false, site: false };
const FIELD = "featured: boolean(),";
const POSTER: S = { line: true, typed: FIELD, typing: false, saved: true, field: true, on: true, status: "live", publishing: false, site: true };

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
  await a.wait(600);
  // The developer adds a field
  await a.move("eol");
  await a.wait(150);
  await a.click();
  await a.set({ line: true, typing: true, saved: false });
  await a.wait(200);
  await a.type("typed", FIELD, { interval: 50 });
  await a.wait(250);
  a.mark("save");
  await a.key("cmd+s");
  await a.set({ saved: true, typing: false });
  await a.wait(300);
  // The admin grows the field it describes
  await a.set({ field: true });
  await a.wait(800);
  // The editor uses it
  await a.move("featured");
  await a.wait(150);
  await a.click();
  await a.set({ on: true, status: "changed" });
  await a.wait(600);
  await a.move({ at: "publish", x: 0.82, y: 0.78 });
  await a.wait(120);
  a.mark("publish");
  await a.click();
  await a.set({ publishing: true });
  await a.wait(450);
  // The site picks it up a beat after the admin says so
  await a.set({ publishing: false, status: "live" });
  await a.wait(350);
  await a.set({ site: true });
  await a.move("rest");
  await a.wait(2400);
  // Undo the line: the field, its switch and the site's mark follow it out
  a.mark("undo");
  await a.set({ typing: true, saved: false });
  await a.key("cmd+z");
  await a.set({ line: false, saved: true, typing: false });
  await a.wait(350);
  await a.set({ field: false, site: false });
  await a.wait(500);
  await a.snap({ ...initial });
  await a.wait(400);
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
      theme="dark"
      fill
      accent="#5fb4c8"
      className="xh"
    >
      {(s, _rect, layout) => {
        const compact = layout === "compact";
        const b = blocks(s, compact);
        return (
          <>
            <Window
              lights="grey"
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
              </div>
            </Window>

            <Window lights="grey" title="xenon.config.ts" className="xh-code" toolbar={<span className="xh-dirty" data-on={!s.saved || undefined} aria-hidden />}>
              <div className="xh-code-body" data-cursor="ibeam">
                <Code lines={b.head} start={b.firstNo} numbers={!compact} />
                <Collapse open={s.line}>
                  <Code lines={[b.added]} start={b.firstNo + b.head.length} numbers={!compact} highlight={false} />
                </Collapse>
                <Code lines={b.tail} start={b.tailNo} numbers={!compact} />
                <span className="xh-eol" data-target="eol" />
              </div>
            </Window>
            {!compact && (
              <Window chrome="hairline" url="yoursite.com/blog" className="xh-site">
                <div className="xh-site-body">
                  <div className="xh-site-head">Journal</div>
                  <div className="xh-post">
                    <img className="xh-post-img" src="/img/p1081-sq.jpg" alt="" width={600} height={600} />
                    <div className="xh-post-text">
                      <Collapse open={s.site} reveal="drop">
                        <div className="xh-flag-wrap">
                          <span className="xh-flag">
                            <Icon name="star" size={12} />
                            Featured
                          </span>
                        </div>
                      </Collapse>
                      <div className="xh-post-title">Designing for slow mornings</div>
                      <Bar w="72%" h={5} tone={2} />
                    </div>
                  </div>
                  <div className="xh-post">
                    <span className="xh-post-img xh-post-img--blank" />
                    <div className="xh-post-text">
                      <Bar w="84%" h={6} tone={3} />
                      <Bar w="56%" h={5} tone={2} />
                    </div>
                  </div>
                </div>
              </Window>
            )}
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
