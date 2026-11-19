"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { href, type NavSection } from "@/docs/nav";

/** The section tree. The page you're on is marked by a glow rule and paper text; the rest stay in mist. */
export function Sidebar({ nav, onNavigate }: { nav: NavSection[]; onNavigate?: () => void }) {
  const path = usePathname().replace(/\/$/, "") || "/";
  return (
    <nav aria-label="Docs" className="grid gap-8 text-small">
      {nav.map((section) => (
        <div key={section.title}>
          <h2 className="mb-2 font-semibold text-paper">{section.title}</h2>
          <ul className="grid border-l border-(--d-line)">
            {section.pages.map((p) => {
              const to = href(p.slug);
              const current = to === path;
              return (
                <li key={to}>
                  <Link
                    href={to}
                    onClick={onNavigate}
                    aria-current={current ? "page" : undefined}
                    className={`-ml-px block border-l py-1.5 pl-4 no-underline transition-colors ${
                      current
                        ? "border-glow text-paper"
                        : "border-transparent text-mist hover:border-(--d-line-hover) hover:text-paper"
                    }`}
                  >
                    {p.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
