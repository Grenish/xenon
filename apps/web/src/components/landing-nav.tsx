"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function LandingNav({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    let previous = -1;

    function update() {
      const distance = Math.min(440, Math.max(260, window.innerHeight * 0.44));
      const progress = Math.max(0, Math.min(1, window.scrollY / distance));
      if (progress === previous) return;
      previous = progress;
      // Ease at either end, with the same position on the way back up.
      const eased = progress * progress * (3 - 2 * progress);
      nav!.style.setProperty("--nav-float", eased.toFixed(4));
    }

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return <nav ref={ref} aria-label="Main" className="landing-nav">{children}</nav>;
}
