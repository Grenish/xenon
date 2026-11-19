import Link from "next/link";
import type { ReactNode } from "react";
import { RiArrowLeftLine, RiArrowRightLine } from "@remixicon/react";
import type { DocPage } from "@/docs/source";
import { Toc } from "./toc";

/** One docs page: its title and summary, the content, then where to go next. "On this page" rides on the right. */
export function DocArticle({ page, children }: { page: Omit<DocPage, "Content">; children: ReactNode }) {
  const hasToc = page.toc.length > 1;
  return (
    <div className="grid min-w-0 xl:grid-cols-[minmax(0,1fr)_216px] xl:gap-16">
      <article id="doc" className="min-w-0 max-w-[720px] pt-12 pb-24 lg:pt-16">
        <header>
          <h1 className="text-[clamp(34px,3.4vw,48px)] leading-[1.05] font-semibold tracking-[-0.03em] text-paper">
            {page.title}
          </h1>
          <p className="mt-4 text-statement text-mist">{page.description}</p>
        </header>

        {hasToc && (
          <details className="docs-toc-mobile mt-8 border-y border-(--d-line) xl:hidden">
            <summary className="flex h-12 cursor-pointer list-none items-center justify-between text-small text-paper">
              On this page
            </summary>
            <div className="pb-4">
              <Toc items={page.toc} spy={false} />
            </div>
          </details>
        )}

        <div className="prose-docs mt-10">{children}</div>

        <footer className="mt-20 border-t border-(--d-line) pt-8">
          {(page.prev || page.next) && (
            <nav aria-label="Pages" className="grid gap-3 sm:grid-cols-2">
              {page.prev ? (
                <Link href={page.prev.href} className="docs-pager">
                  <span className="flex items-center gap-1.5 text-small text-mist">
                    <RiArrowLeftLine size={14} aria-hidden /> Previous
                  </span>
                  <span className="mt-1 block font-medium text-paper">{page.prev.title}</span>
                </Link>
              ) : (
                <span aria-hidden />
              )}
              {page.next && (
                <Link href={page.next.href} className="docs-pager sm:text-right">
                  <span className="flex items-center gap-1.5 text-small text-mist sm:justify-end">
                    Next <RiArrowRightLine size={14} aria-hidden />
                  </span>
                  <span className="mt-1 block font-medium text-paper">{page.next.title}</span>
                </Link>
              )}
            </nav>
          )}
          <a href={page.editUrl} className="mt-8 inline-block text-small text-mist hover:text-paper">
            Edit this page on GitHub
          </a>
        </footer>
      </article>

      {hasToc && (
        <aside className="sticky top-14 h-fit max-h-[calc(100svh-56px)] overflow-y-auto pt-16 pb-10 max-xl:hidden">
          <p className="mb-3 text-small font-semibold text-paper">On this page</p>
          <Toc items={page.toc} spy />
        </aside>
      )}
    </div>
  );
}
