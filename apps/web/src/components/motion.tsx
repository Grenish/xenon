"use client";

import { useEffect } from "react";

/**
 * Section entrances: every `[data-rise]` child of a section rises in once, staggered, as the section
 * enters. Content is visible without script; the hidden start state only applies once `.js-motion` is set.
 */
export function Motion() {
  useEffect(() => {
    const root = document.documentElement;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    root.classList.add("js-motion");
    const groups = Array.from(document.querySelectorAll<HTMLElement>("[data-rise-group]"));
    for (const g of groups) {
      Array.from(g.querySelectorAll<HTMLElement>("[data-rise]")).forEach((el, i) => {
        el.style.setProperty("--d", `${Math.min(i, 6) * 80}ms`);
      });
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );
    groups.forEach((g) => io.observe(g));
    return () => io.disconnect();
  }, []);
  return null;
}
