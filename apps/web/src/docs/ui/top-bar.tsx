"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RiCloseLine, RiMenuLine } from "@remixicon/react";
import { XenonMark } from "@/components/logo";
import type { NavSection } from "@/docs/nav";
import { Sidebar } from "./sidebar";
import { SearchDialog } from "./search-dialog";
import { ThemeSwitch } from "./theme-switch";

const GITHUB = "https://github.com/Grenish/xenon";

/** The bar above every docs page. On small screens it also holds the menu that opens the section tree. */
export function TopBar({ nav }: { nav: NavSection[] }) {
  const [open, setOpen] = useState(false);
  const sheet = useRef<HTMLDialogElement>(null);
  const path = usePathname();

  useEffect(() => {
    const d = sheet.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  // A navigation closes the sheet
  useEffect(() => setOpen(false), [path]);

  return (
    <header className="sticky top-0 z-40 border-b border-(--d-line) bg-void/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-4 px-gutter text-small">
        <button
          type="button"
          className="-ml-2 grid size-10 cursor-pointer place-items-center text-mist hover:text-paper lg:hidden"
          aria-label="Open the docs menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <RiMenuLine size={20} aria-hidden />
        </button>
        <Link href="/" className="inline-flex items-center gap-2.5 font-semibold text-paper no-underline" aria-label="Xenon, home">
          <XenonMark className="h-3.5 w-auto" />
          <span className="text-body">Xenon</span>
        </Link>
        <Link href="/docs" className="text-mist no-underline hover:text-paper max-sm:hidden">
          Docs
        </Link>
        <div className="ml-auto flex items-center gap-5">
          <SearchDialog />
          <ThemeSwitch className="max-sm:hidden" />
          <a href={GITHUB} className="text-mist no-underline hover:text-paper max-sm:hidden">
            GitHub
          </a>
        </div>
      </div>

      <dialog
        ref={sheet}
        className="docs-sheet m-0 h-svh max-h-none w-[min(320px,86vw)] max-w-none bg-coal p-0 text-paper"
        aria-label="Docs menu"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        <div className="flex h-14 items-center justify-between border-b border-(--d-line) px-5">
          <span className="font-semibold">Docs</span>
          <button
            type="button"
            className="-mr-2 grid size-10 cursor-pointer place-items-center text-mist hover:text-paper"
            aria-label="Close the docs menu"
            onClick={() => setOpen(false)}
          >
            <RiCloseLine size={20} aria-hidden />
          </button>
        </div>
        <div className="h-[calc(100svh-56px)] overflow-y-auto px-5 py-8">
          <Sidebar nav={nav} onNavigate={() => setOpen(false)} />
          <div className="mt-10 flex items-center justify-between border-t border-(--d-line) pt-6 text-small text-mist sm:hidden">
            Theme
            <ThemeSwitch />
          </div>
        </div>
      </dialog>
    </header>
  );
}
