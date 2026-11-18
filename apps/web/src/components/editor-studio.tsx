"use client";

import { useId, useState } from "react";

// The pinned "for editors" section: the left side is the post as readers see it
// on the site; the right side is the admin's own controls. Every change lands on
// the page at once, and changes persist down the column.

const COVERS = [
  { src: "/img/p1081.jpg", thumb: "/img/p1081-sq.jpg", alt: "A stepped white building corner against a pale blue sky" },
  { src: "/img/p618.jpg", thumb: "/img/p618-sq.jpg", alt: "A curving glass and steel lattice roof in black and white" },
  { src: "/img/p693.jpg", thumb: "/img/p693-sq.jpg", alt: "A red suspension bridge tower rising out of fog" },
  { src: "/img/p887.jpg", thumb: "/img/p887-sq.jpg", alt: "A white apartment facade with rows of balconies" },
];
const CATEGORIES = ["Guide", "News", "Essay"];

export function EditorStudio() {
  const [title, setTitle] = useState("Designing for slow mornings");
  const [cover, setCover] = useState(0);
  const [category, setCategory] = useState(0);
  const [live, setLive] = useState(false);
  const titleId = useId();
  const pic = COVERS[cover]!;

  return (
    <div className="studio">
      <header className="studio-head">
          <h2 id="editors-title" className="h2">
            Built for the people who write
          </h2>
          <p className="lede">
            Editors never see the code. They get a quiet admin with the fields your site needs, and nothing it doesn&rsquo;t.
            Try it: the post beside these controls is the page your readers get.
          </p>
      </header>
      <div className="studio-stage">
        <article className="site-post" data-ui aria-live="polite">
          <div className="site-bar">
            <span className="site-name">Northwind Journal</span>
            <span className="site-url">northwind.studio/blog</span>
          </div>
          <img className="site-cover" src={pic.src} alt={pic.alt} width={1600} height={1000} />
          <div className="site-body">
            <div className="site-meta">
              <span className="site-cat">{CATEGORIES[category]}</span>
              <span>Maya Lind · 6 min read</span>
            </div>
            <h3 className="site-title">{title.trim() || "Untitled"}</h3>
            <p className="site-excerpt">
              The best rooms change with the light. Notes on orientation, thresholds and the first hour of the day.
            </p>
          </div>
          <div className="site-state" data-live={live || undefined}>
            {live ? "Live on northwind.studio" : "Draft · only your team can see this"}
          </div>
        </article>
      </div>

      <div className="studio-column">

        <div className="block">
          <h3 className="h3">Write in an editor, not a form</h3>
          <p>
            Headings, lists, links and images in a real rich-text editor, saved as clean JSON that your site renders with one
            component.
          </p>
          <label className="ctl-label" htmlFor={titleId}>
            Title
          </label>
          <input
            id={titleId}
            className="ctl-input"
            data-ui
            value={title}
            maxLength={70}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="block">
          <h3 className="h3">Pick images from your library</h3>
          <p>Uploads go to local disk, S3 or Cloudflare R2. Alt text can be required, so nothing ships without it.</p>
          <div className="ctl-covers" role="radiogroup" aria-label="Cover image" data-ui>
            {COVERS.map((c, i) => (
              <button
                key={c.src}
                type="button"
                role="radio"
                aria-checked={cover === i}
                aria-label={c.alt}
                className="ctl-cover"
                onClick={() => setCover(i)}
              >
                <img src={c.thumb} alt="" width={640} height={640} loading="lazy" />
              </button>
            ))}
          </div>
        </div>

        <div className="block">
          <h3 className="h3">Only the fields you need</h3>
          <p>Selects, relations, numbers and switches: exactly the ones your developer defined. Nothing else to learn.</p>
          <div className="ctl-seg" role="radiogroup" aria-label="Category" data-ui>
            {CATEGORIES.map((c, i) => (
              <button key={c} type="button" role="radio" aria-checked={category === i} onClick={() => setCategory(i)}>
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="block">
          <h3 className="h3">Drafts stay drafts until you publish</h3>
          <p>
            Save as often as you like. Readers get the new version the moment you publish, because Xenon expires exactly the
            cached pages that changed.
          </p>
          <div className="ctl-publish" data-ui>
            <span className="ctl-pill" data-live={live || undefined}>
              {live ? "Published" : "Draft"}
            </span>
            <button type="button" className="ctl-btn" onClick={() => setLive((v) => !v)}>
              {live ? "Unpublish" : "Publish"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
