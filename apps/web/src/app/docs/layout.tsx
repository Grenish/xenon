import type { ReactNode } from "react";
import { nav } from "@/docs/nav";
import { TopBar } from "@/docs/ui/top-bar";
import { Sidebar } from "@/docs/ui/sidebar";
import { ScrollbarActivity } from "@/docs/ui/scrollbar-activity";
import { THEME_SCRIPT } from "@/docs/ui/theme-switch";
import "@/docs/docs.css";

/** The docs frame: a top bar, the section tree on the left, the page in the rest. */
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    // The saved theme is set on this element by the script below before it paints, so React sees a different
    // data-theme than it rendered: expected, not a mismatch.
    <div className="docs min-h-svh bg-void text-paper" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <ScrollbarActivity />
      <a
        className="absolute -top-20 left-gutter z-50 bg-paper px-4 py-3 text-void focus:top-3"
        href="#doc"
      >
        Skip to content
      </a>
      <TopBar nav={nav} />
      <div className="mx-auto grid max-w-[1440px] px-gutter lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-12">
        <aside className="sticky top-14 h-[calc(100svh-56px)] overflow-y-auto overscroll-contain py-10 pr-2 max-lg:hidden">
          <Sidebar nav={nav} />
        </aside>
        {children}
      </div>
    </div>
  );
}
