"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { RiCornerDownLeftLine, RiSearchLine } from "@remixicon/react";

/** One record of /docs/search.json: an h2/h3 section of a page (heading "" = the page's opening). */
type SearchRecord = { url: string; page: string; heading: string; text: string };

/** The index, fetched once. `null` when it couldn't be loaded (the next open tries again). */
let index: Promise<SearchRecord[] | null> | null = null;
function loadIndex() {
  index ??= fetch("/docs/search.json")
    .then((r) => (r.ok ? (r.json() as Promise<SearchRecord[]>) : Promise.reject()))
    .catch(() => {
      index = null;
      return null;
    });
  return index;
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9@./-]+/).filter(Boolean);

/** Every query word must start some word in the record; page titles outrank headings, headings outrank text. */
function search(records: SearchRecord[], q: string) {
  const terms = words(q);
  if (!terms.length) return [];
  const scored: { r: SearchRecord; score: number }[] = [];
  for (const r of records) {
    const page = words(r.page);
    const heading = words(r.heading);
    const text = words(r.text);
    let score = 0;
    for (const t of terms) {
      const hit = (ws: string[]) => ws.some((w) => w.startsWith(t));
      if (hit(page)) score += 6;
      else if (hit(heading)) score += 4;
      else if (hit(text)) score += 1;
      else {
        score = 0;
        break;
      }
    }
    if (score) scored.push({ r, score: score - (r.heading ? 0.5 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 8).map((s) => s.r);
}

/** A short piece of text around the first hit, so a result shows why it matched. */
function excerpt(text: string, q: string) {
  const t = words(q)[0];
  const at = t ? text.toLowerCase().indexOf(t) : -1;
  if (at < 0) return text.slice(0, 120);
  const from = Math.max(0, at - 40);
  return (from ? "…" : "") + text.slice(from, from + 130);
}

/** The search button in the top bar and the dialog it opens. ⌘K / Ctrl K / "/" open it from anywhere. */
export function SearchDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [records, setRecords] = useState<SearchRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [mac, setMac] = useState(true);

  const results = useMemo(() => (records ? search(records, q) : []), [records, q]);

  const open = () => {
    const d = dialog.current;
    if (!d || d.open) return;
    d.showModal();
    input.current?.select();
    loadIndex().then((r) => {
      setFailed(!r);
      if (r) setRecords(r);
    });
  };

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        open();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => setSel(0), [q]);

  const go = (r: SearchRecord | undefined) => {
    if (!r) return;
    dialog.current?.close();
    router.push(r.url);
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        onPointerEnter={() => void loadIndex()}
        className="flex h-9 cursor-pointer items-center gap-2.5 border border-(--d-line-strong) bg-coal px-3 text-mist transition-colors hover:border-(--d-line-hover) hover:text-paper sm:w-56"
        aria-label="Search the docs"
      >
        <RiSearchLine size={16} aria-hidden />
        <span className="max-sm:hidden">Search</span>
        <kbd className="ml-auto font-sans text-[12px] text-mist/70 max-sm:hidden">{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>

      <dialog
        ref={dialog}
        aria-label="Search the docs"
        className="docs-search mx-auto mt-[12vh] w-[min(640px,calc(100vw-32px))] max-w-none border border-(--d-line-strong) bg-coal p-0 text-paper"
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        onClose={() => setQ("")}
      >
        <div className="flex h-14 items-center gap-3 border-b border-(--d-line) px-4">
          <RiSearchLine size={18} className="shrink-0 text-mist" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(results[sel]);
              }
            }}
            placeholder="Search the docs"
            className="h-full min-w-0 flex-1 bg-transparent text-body text-paper outline-none placeholder:text-mist/70"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="docs-search-results"
            aria-activedescendant={results[sel] ? `docs-search-${sel}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="font-sans text-[12px] text-mist/70">Esc</kbd>
        </div>

        <ul id="docs-search-results" role="listbox" className="max-h-[min(60vh,480px)] overflow-y-auto p-2">
          {results.map((r, i) => (
            <li
              key={r.url}
              id={`docs-search-${i}`}
              role="option"
              aria-selected={i === sel}
              onPointerMove={() => setSel(i)}
              onClick={() => go(r)}
              className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 ${i === sel ? "bg-(--d-hover)" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-small">
                  <span className={i === sel ? "text-paper" : "text-paper/90"}>{r.page}</span>
                  {r.heading && <span className="text-mist"> / {r.heading}</span>}
                </p>
                <p className="mt-0.5 line-clamp-2 text-small text-mist">{excerpt(r.text, q)}</p>
              </div>
              {i === sel && <RiCornerDownLeftLine size={16} className="mt-0.5 shrink-0 text-glow" aria-hidden />}
            </li>
          ))}
        </ul>
        {q && records && !results.length && <p className="px-5 pt-2 pb-6 text-small text-mist">Nothing matches “{q}”.</p>}
        {failed && <p className="px-5 pt-2 pb-6 text-small text-mist">Search isn’t available right now. Try again in a moment.</p>}
        {q && !records && !failed && <p className="px-5 pt-2 pb-6 text-small text-mist">Loading the index…</p>}
      </dialog>
    </>
  );
}
