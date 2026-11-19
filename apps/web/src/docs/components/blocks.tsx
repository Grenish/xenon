import Link from "next/link";
import type { ReactNode } from "react";
import { RiAlertLine, RiArrowRightUpLine, RiInformationLine } from "@remixicon/react";

/** An aside: `note` (default) for the thing worth knowing, `warning` for the thing that will bite. */
export function Callout({ tone = "note", children }: { tone?: "note" | "warning"; children: ReactNode }) {
  const Icon = tone === "warning" ? RiAlertLine : RiInformationLine;
  return (
    <aside className="docs-callout" data-tone={tone}>
      <Icon size={18} className="docs-callout__icon" aria-label={tone === "warning" ? "Warning" : "Note"} />
      <div className="docs-callout__body">{children}</div>
    </aside>
  );
}

/** Wraps `###` headings and what follows each into numbered steps on a rail. */
export function Steps({ children }: { children: ReactNode }) {
  return <div className="docs-steps">{children}</div>;
}

export function Cards({ children }: { children: ReactNode }) {
  return <div className="docs-cards">{children}</div>;
}

/** A "next" link at the foot of a page. */
export function Card({ href, title, children }: { href: string; title: string; children?: ReactNode }) {
  const external = /^https?:/.test(href);
  const body = (
    <>
      <span className="flex items-center justify-between gap-3 font-medium text-paper">
        {title}
        <RiArrowRightUpLine size={16} className="docs-card__arrow shrink-0" aria-hidden />
      </span>
      {children && <span className="mt-1.5 block text-small text-mist [&_p]:m-0">{children}</span>}
    </>
  );
  return external ? (
    <a href={href} className="docs-card">
      {body}
    </a>
  ) : (
    <Link href={href} className="docs-card">
      {body}
    </Link>
  );
}
