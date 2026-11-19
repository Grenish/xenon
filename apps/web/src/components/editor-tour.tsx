"use client";

import type React from "react";
import { useEffect, useId, useRef, useState } from "react";
import {
  RiBold,
  RiCheckLine,
  RiH2,
  RiImageLine,
  RiItalic,
  RiLink,
  RiListUnordered,
  RiUploadCloud2Line,
} from "@remixicon/react";

export type EditorRow = { title: string; text: string; terms: string[] };

const DWELL = 6500; // ms each feature stays up while the tour plays itself

/**
 * For the people who write: the five things editors get, as a tour. The rows on the right are tabs; the
 * light panel shows the selected one at work in a small admin preview. While the section is in view
 * and nobody is pointing at the rows, the tour steps through on its own, with a progress line on the
 * active row; the first deliberate pick stops it. On a phone the preview opens inside the active row instead.
 * Reduced motion: no autoplay, and each preview shows its finished state.
 */
export function EditorTour({ rows }: { rows: EditorRow[] }) {
  const [active, setActive] = useState(0);
  const [manual, setManual] = useState(false);
  const [held, setHeld] = useState(false);
  const [inView, setInView] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [wide, setWide] = useState(true);
  const root = useRef<HTMLElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const playing = !manual && !held && inView && !reduced && wide;

  useEffect(() => {
    const rm = matchMedia("(prefers-reduced-motion: reduce)");
    const md = matchMedia("(min-width: 768px)");
    const sync = () => {
      setReduced(rm.matches);
      setWide(md.matches);
    };
    sync();
    rm.addEventListener("change", sync);
    md.addEventListener("change", sync);
    const io = new IntersectionObserver(([e]) => setInView(!!e?.isIntersecting), { threshold: 0.4 });
    if (root.current) io.observe(root.current);
    return () => {
      rm.removeEventListener("change", sync);
      md.removeEventListener("change", sync);
      io.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setActive((a) => (a + 1) % rows.length), DWELL);
    return () => clearTimeout(t);
  }, [playing, active, rows.length]);

  const pick = (i: number) => {
    setManual(true);
    setActive(i);
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + rows.length) % rows.length;
    pick(n);
    tabs.current[n]?.focus();
  };

  const panelId = `${id}-panel`;
  return (
    <section
      ref={root}
      id="editors"
      className="mt-section grid grid-cols-[minmax(0,1fr)] md:grid-cols-2"
      aria-labelledby="editors-title"
      data-rise-group
    >
      <div className="flex min-h-[90svh] flex-col gap-10 bg-sheet p-gutter text-ink max-md:min-h-0 max-md:py-14">
        <h2 id="editors-title" className="text-h2 font-semibold max-md:text-[10vw]">
          <span className="block">For the people</span>
          <span className="block text-right">who write</span>
        </h2>
        <div className="grid flex-1 place-items-center max-md:hidden">
          <div id={panelId} role="tabpanel" aria-label={rows[active]?.title} className="w-full max-w-[520px]">
            <Preview key={active} index={active} reduced={reduced} />
          </div>
        </div>
        <div className="flex items-end justify-between gap-8 max-lg:flex-col max-lg:items-start">
          <p className="max-w-[32ch]" data-rise>
            Editors never see the code. They get the fields your site needs and nothing it doesn&rsquo;t, in an admin
            that stays out of the way.
          </p>
          <a className="btn btn--ink" href="#try-title" data-rise>
            Try the admin
          </a>
        </div>
      </div>

      {/* Pointing at the rows, or focus inside them, holds the tour where it is */}
      <div
        className="grid grid-cols-[minmax(0,1fr)] md:auto-rows-fr"
        role="tablist"
        aria-orientation="vertical"
        aria-labelledby="editors-title"
        onPointerEnter={() => setHeld(true)}
        onPointerLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setHeld(false)}
      >
        {rows.map((r, i) => {
          const on = i === active;
          return (
            <div key={r.title} className={`${on ? "bg-[#202226]" : i % 2 ? "bg-coal-2" : "bg-coal"} relative transition-colors duration-300`} data-rise>
              <button
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={panelId}
                tabIndex={on ? 0 : -1}
                onClick={() => pick(i)}
                onKeyDown={(e) => onKey(e, i)}
                className="grid w-full cursor-pointer content-start md:h-full gap-x-6 gap-y-2 p-7 text-left outline-none focus-visible:shadow-[inset_2px_0_0_var(--color-glow)] lg:grid-cols-12"
              >
                <span className={`text-statement font-semibold transition-colors duration-300 lg:col-span-4 ${on ? "text-paper" : "text-mist"}`}>
                  {r.title}
                </span>
                <span className={`transition-colors duration-300 lg:col-span-5 ${on ? "text-paper" : "text-mist/80"}`}>{r.text}</span>
                <span className="flex flex-col text-small text-mist lg:col-span-3 max-lg:flex-row max-lg:flex-wrap max-lg:gap-x-2">
                  {r.terms.map((t) => (
                    <span key={t} className="max-lg:after:content-[','] max-lg:last:after:content-['']">
                      {t}
                    </span>
                  ))}
                </span>
              </button>
              {/* Phone: the preview opens inside its own row */}
              {on && (
                <div className="px-5 pb-6 md:hidden">
                  <Preview index={i} reduced={reduced} />
                </div>
              )}
              {/* The tour's clock: fills while this row is up */}
              {on && playing && (
                <span
                  key={`p${active}`}
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-glow"
                  style={{ animation: `tour-progress ${DWELL}ms linear both` }}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Steps through a preview's little story while it's showing; reduced motion shows the last step. */
function useStep(count: number, ms: number, reduced: boolean) {
  const [step, setStep] = useState(reduced ? count - 1 : 0);
  useEffect(() => {
    if (reduced) {
      setStep(count - 1);
      return;
    }
    const t = setInterval(() => setStep((s) => (s + 1) % count), ms);
    return () => clearInterval(t);
  }, [count, ms, reduced]);
  return step;
}

function Preview({ index, reduced }: { index: number; reduced: boolean }) {
  const P = [Drafts, RichText, Media, Presence, Roles][index] ?? Drafts;
  return (
    <div className="animate-fade-up motion-reduce:animate-none">
      <P reduced={reduced} />
    </div>
  );
}

/* ---------- The admin pieces, in the admin's light theme and the page's square language */

function Sheet({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[4px] border border-[#e1e4e8] bg-white text-[13px] text-ink shadow-[0_18px_40px_-24px_rgb(19_20_22/0.35)]" aria-hidden>
      <div className="flex h-12 items-center justify-between gap-3 border-b border-[#eff1f3] px-4">
        <span className="truncate font-semibold">{title}</span>
        <span className="flex shrink-0 items-center gap-2">{aside}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[12px] font-medium text-slate">{children}</div>;
}

function Input({ children, lit }: { children: React.ReactNode; lit?: boolean }) {
  return (
    <div
      className={`flex min-h-8 items-center rounded-[3px] border px-2.5 py-1.5 transition-colors duration-500 ${lit ? "border-teal/40 bg-[#e3f0f3]" : "border-[#dde0e4] bg-white"}`}
    >
      {children}
    </div>
  );
}

function Pill({ tone, children }: { tone: "live" | "changed" | "neutral" | "teal"; children: React.ReactNode }) {
  const t = {
    live: "bg-[#e5f3ea] text-[#1f6b3a]",
    changed: "bg-[#fbf0dc] text-[#8a5a12]",
    neutral: "bg-[#eef0f2] text-slate",
    teal: "bg-[#e3f0f3] text-teal",
  }[tone];
  return (
    <span className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors duration-300 ${t}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

function Button({ pressed, children }: { pressed?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex h-8 items-center rounded-[3px] px-3 text-[12.5px] font-medium text-white transition-[background-color,transform] duration-150 ${pressed ? "translate-y-px bg-[#2a2c30]" : "bg-ink"}`}
    >
      {children}
    </span>
  );
}

function Caret() {
  return <span className="ml-px inline-block h-4 w-px translate-y-0.5 animate-pulse bg-ink" />;
}

function Drafts({ reduced }: { reduced: boolean }) {
  const step = useStep(4, 1500, reduced);
  const edited = step >= 1 && step <= 2;
  const status = step === 0 || step === 3 ? <Pill tone="live">Published</Pill> : <Pill tone="changed">Unpublished changes</Pill>;
  return (
    <Sheet
      title="Designing for slow mornings"
      aside={
        <>
          {status}
          <Button pressed={step === 2}>Publish</Button>
        </>
      }
    >
      <Label>Title</Label>
      <Input>Designing for slow mornings</Input>
      <div className="mt-3">
        <Label>Excerpt</Label>
        <Input lit={edited}>
          <span>
            A slow start{step >= 1 ? ", on purpose." : "."}
            {step === 1 && <Caret />}
          </span>
        </Input>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <Label>Category</Label>
          <Input>Guide</Input>
        </div>
        <div>
          <Label>Author</Label>
          <Input>Maya Ortiz</Input>
        </div>
      </div>
    </Sheet>
  );
}

function RichText({ reduced }: { reduced: boolean }) {
  const step = useStep(4, 1200, reduced);
  const items = ["Open the window", "Make the coffee", "Write one line"];
  const tool = (on: boolean) => `grid size-7 place-items-center rounded-[3px] ${on ? "bg-[#e3f0f3] text-teal" : "text-slate"}`;
  return (
    <Sheet title="Body" aside={<Pill tone="neutral">Rich text</Pill>}>
      <div className="mb-3 flex gap-1 border-b border-[#eff1f3] pb-2">
        <span className={tool(false)}><RiBold size={15} /></span>
        <span className={tool(false)}><RiItalic size={15} /></span>
        <span className={tool(step === 0)}><RiH2 size={15} /></span>
        <span className={tool(step >= 1)}><RiListUnordered size={15} /></span>
        <span className={tool(false)}><RiLink size={15} /></span>
        <span className={tool(false)}><RiImageLine size={15} /></span>
      </div>
      <div className="text-[17px] leading-tight font-semibold">Slow mornings</div>
      <p className="mt-2 text-[13px] leading-relaxed text-[#3b3e42]">
        Start with <span className="text-teal underline decoration-teal/40 underline-offset-2">light</span>, not with a screen.
      </p>
      <ul className="mt-2 min-h-[66px] list-disc space-y-0.5 pl-5 text-[13px] text-[#3b3e42] marker:text-teal">
        {items.slice(0, Math.max(1, step)).map((t, i) => (
          <li key={t} className="animate-fade-up motion-reduce:animate-none">
            {t}
            {i === step - 1 && step < 3 && <Caret />}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function Media({ reduced }: { reduced: boolean }) {
  const step = useStep(4, 1400, reduced);
  const pics = ["/img/p1081-sq.jpg", "/img/p693-sq.jpg", "/img/p618-sq.jpg", "/img/p887-sq.jpg"];
  const upload = [30, 62, 100, 100][step] ?? 100;
  return (
    <Sheet title="Media library" aside={<Button pressed={step === 3}>Insert</Button>}>
      <div className="grid grid-cols-3 gap-2">
        {pics.map((src, i) => (
          <div key={src} className={`relative aspect-[4/3] overflow-hidden rounded-[3px] ring-2 transition-shadow duration-300 ${i === 1 && step >= 1 ? "ring-teal" : "ring-transparent"}`}>
            <img src={src} alt="" width={600} height={600} loading="lazy" className="size-full object-cover" />
            {i === 1 && step >= 1 && (
              <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-teal text-white">
                <RiCheckLine size={13} />
              </span>
            )}
          </div>
        ))}
        <div className="grid aspect-[4/3] place-items-center rounded-[3px] bg-[#f1f3f5] text-slate">
          <div className="flex w-3/4 flex-col items-center gap-2">
            <RiUploadCloud2Line size={18} />
            <span className="h-1 w-full overflow-hidden rounded-full bg-[#dde0e4]">
              <span className="block h-full bg-teal transition-[width] duration-700" style={{ width: `${upload}%` }} />
            </span>
          </div>
        </div>
        <div className="aspect-[4/3] rounded-[3px] bg-[#f6f7f8]" />
      </div>
      <div className="mt-3">
        <Label>Alt text</Label>
        <Input lit={step === 2}>
          {step >= 2 ? (
            <span>
              Concrete stairs in morning light
              {step === 2 && <Caret />}
            </span>
          ) : (
            <span className="text-[#9a9ea3]">Describe the image</span>
          )}
        </Input>
      </div>
    </Sheet>
  );
}

function Avatar({ initials, tone, ring }: { initials: string; tone: string; ring?: boolean }) {
  return (
    <span className={`grid size-7 place-items-center rounded-full text-[11px] font-semibold text-white ring-2 ring-white ${tone} ${ring ? "outline-2 outline-offset-1 outline-teal" : ""}`}>
      {initials}
    </span>
  );
}

function Presence({ reduced }: { reduced: boolean }) {
  const step = useStep(4, 1600, reduced);
  const maya = step >= 1;
  return (
    <Sheet
      title="Designing for slow mornings"
      aside={
        <span className="flex -space-x-1.5">
          <Avatar initials="JP" tone="bg-ink" />
          <span className={`transition-[opacity,transform] duration-300 ${maya ? "opacity-100" : "translate-x-1 opacity-0"}`}>
            <Avatar initials="MO" tone="bg-teal" ring={step === 1} />
          </span>
        </span>
      }
    >
      <div
        className={`mb-3 flex items-center justify-between gap-3 overflow-hidden rounded-[3px] bg-[#e3f0f3] px-3 text-[12.5px] text-[#0f4250] transition-[height,opacity] duration-300 ${maya ? "h-10 opacity-100" : "h-0 opacity-0"}`}
      >
        <span>Maya is editing. You&rsquo;re watching her saves.</span>
        <span className="font-medium text-teal">Take over</span>
      </div>
      <Label>Title</Label>
      <Input lit={step === 2}>{step >= 2 ? "Designing for slow Sunday mornings" : "Designing for slow mornings"}</Input>
      <div className="mt-3">
        <Label>Excerpt</Label>
        <Input>A slow start, on purpose.</Input>
      </div>
      <div className={`mt-3 flex items-center gap-1.5 text-[12px] text-slate transition-opacity duration-300 ${step >= 2 ? "opacity-100" : "opacity-0"}`}>
        <RiCheckLine size={14} className="text-teal" />
        Saved by Maya, just now
      </div>
    </Sheet>
  );
}

function Roles({ reduced }: { reduced: boolean }) {
  const step = useStep(4, 1500, reduced);
  const email = "sam@studio.dev";
  const people: [string, string, string, React.ReactNode][] = [
    ["JP", "bg-ink", "Jon Park", <Pill key="a" tone="teal">Admin</Pill>],
    ["MO", "bg-teal", "Maya Ortiz", <Pill key="e" tone="neutral">Editor</Pill>],
  ];
  return (
    <Sheet title="Team" aside={<Button pressed={step === 2}>Invite</Button>}>
      <Input lit={step === 1}>
        {step >= 1 ? (
          <span>
            {step === 1 ? email.slice(0, 9) : email}
            {step === 1 && <Caret />}
          </span>
        ) : (
          <span className="text-[#9a9ea3]">Email address</span>
        )}
      </Input>
      <ul className="mt-3 divide-y divide-[#eff1f3]">
        {people.map(([ini, tone, name, role]) => (
          <li key={name} className="flex h-11 items-center gap-2.5">
            <Avatar initials={ini} tone={tone} />
            <span className="flex-1 truncate">{name}</span>
            {role}
          </li>
        ))}
        <li className={`flex items-center gap-2.5 overflow-hidden transition-[height,opacity] duration-300 ${step >= 2 ? "h-11 opacity-100" : "h-0 opacity-0"}`}>
          <span className="grid size-7 place-items-center rounded-full bg-[#eef0f2] text-[11px] font-semibold text-slate">S</span>
          <span className="flex-1 truncate">{email}</span>
          {step >= 3 ? <Pill tone="neutral">Editor</Pill> : <Pill tone="changed">Invited</Pill>}
        </li>
      </ul>
    </Sheet>
  );
}
