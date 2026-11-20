"use client";

import { useEffect } from "react";

export function ScrollbarActivity() {
  useEffect(() => {
    const timers = new Map<Element, number>();

    function onScroll(event: Event) {
      const area = event.target === document ? document.scrollingElement : event.target;
      if (!(area instanceof Element)) return;
      if (area !== document.scrollingElement && !area.matches(".docs aside.overflow-y-auto")) return;

      area.toggleAttribute("data-docs-scrolling", true);
      window.clearTimeout(timers.get(area));
      timers.set(area, window.setTimeout(() => {
        area.removeAttribute("data-docs-scrolling");
        timers.delete(area);
      }, 700));
    }

    // Element scroll events do not bubble. Capture also covers sidebars added on navigation.
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      for (const [area, timer] of timers) {
        window.clearTimeout(timer);
        area.removeAttribute("data-docs-scrolling");
      }
    };
  }, []);

  return null;
}
