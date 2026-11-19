"use client";

import { useEffect, useState } from "react";
import type { TocItem } from "@/docs/source";

/**
 * "On this page". With `spy`, the heading you're reading is marked: the last heading that has passed a line a
 * little below the top bar.
 */
export function Toc({ items, spy }: { items: TocItem[]; spy: boolean }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!spy) return;
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const line = 120;
      let current = els[0]!.id;
      for (const el of els) {
        if (el.getBoundingClientRect().top <= line) current = el.id;
        else break;
      }
      // At the foot of the page the last heading may never reach the line
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) current = els[els.length - 1]!.id;
      setActive(current);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [items, spy]);

  return (
    <ul className="grid text-small">
      {items.map((i) => (
        <li key={i.id}>
          <a
            href={`#${i.id}`}
            aria-current={active === i.id ? "location" : undefined}
            className={`block py-1 no-underline transition-colors ${i.depth === 3 ? "pl-3.5" : ""} ${
              active === i.id ? "text-glow" : "text-mist hover:text-paper"
            }`}
          >
            {i.text}
          </a>
        </li>
      ))}
    </ul>
  );
}
