"use client";
import {
  RiArrowRightSLine,
  RiArrowRightUpLine,
  RiArrowUpDownLine,
  RiComputerLine,
  RiFileTextLine,
  RiHome5Line,
  RiImageLine,
  RiLogoutBoxRLine,
  RiMenuLine,
  RiMoonLine,
  RiSearchLine,
  RiSettings3Line,
  RiSunLine,
  RiTeamLine,
  RiUserLine,
} from "@remixicon/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ComponentType, Fragment, type ReactNode, useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "../components/avatar";
import { Button } from "../components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/dropdown-menu";
import { Kbd } from "../components/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "../components/popover";
import { Sheet, SheetContent, SheetTitle } from "../components/sheet";
import { cn } from "../lib/utils";
import { useAdmin } from "../shared/admin-context";
import type { ClientCollection } from "../shared/client-config";
import { adminRoutes } from "../shared/services";
import { ElementMark } from "./brand";
import { CommandPalette } from "./command-palette";
import { initials } from "./format";
import { type AdminTheme, useAdminRuntime } from "./runtime";
import { AvatarStack, dedupe, displayName, PersonAvatar, usePresence } from "./presence";
import { type Crumb, useShellBarContent } from "./shell-bar";
import type { PresencePeer } from "../../adapters/types";

type Icon = ComponentType<{ className?: string }>;

export function collectionIcon(c: ClientCollection): Icon {
  return c.upload ? RiImageLine : RiFileTextLine;
}

/* -------------------------------------------------------------------------- sidebar */

function NavLink({ href, icon: Icon, children, active, onNavigate }: { href: string; icon: Icon; children: ReactNode; active: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "xe:group xe:flex xe:h-8 xe:items-center xe:gap-2.5 xe:rounded-md xe:px-2.5 xe:text-sm xe:transition-colors",
        active
          ? "xe:bg-sidebar-accent xe:font-medium xe:text-sidebar-accent-foreground"
          : "xe:text-sidebar-foreground xe:hover:bg-sidebar-accent/60 xe:hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className={cn("xe:size-4 xe:shrink-0", active ? "xe:text-foreground" : "xe:text-muted-foreground xe:group-hover:text-foreground")} />
      <span className="xe:truncate">{children}</span>
    </Link>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { basePath, collections } = useAdmin();
  const pathname = usePathname();
  const isActive = (href: string, exact = false) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  const groups = new Map<string, ClientCollection[]>();
  for (const c of collections) {
    const group = c.admin.group ?? (c.upload ? "Library" : "Content");
    groups.set(group, [...(groups.get(group) ?? []), c]);
  }

  return (
    <nav className="xe:flex xe:flex-1 xe:flex-col xe:gap-5 xe:overflow-y-auto xe:px-3 xe:pt-2 xe:pb-3" aria-label="Main">
      <div className="xe:flex xe:flex-col xe:gap-px">
        <NavLink href={adminRoutes.dashboard(basePath)} icon={RiHome5Line} active={isActive(adminRoutes.dashboard(basePath), true)} onNavigate={onNavigate}>
          Overview
        </NavLink>
      </div>
      {[...groups].map(([group, items]) => (
        <div key={group} className="xe:flex xe:flex-col xe:gap-px">
          <p className="xe:px-2.5 xe:pb-1.5 xe:text-xs xe:text-muted-foreground">{group}</p>
          {items.map((c) => (
            <NavLink key={c.slug} href={adminRoutes.list(basePath, c.slug)} icon={collectionIcon(c)} active={isActive(adminRoutes.list(basePath, c.slug))} onNavigate={onNavigate}>
              {c.labels.plural}
            </NavLink>
          ))}
        </div>
      ))}
      <div className="xe:mt-auto xe:flex xe:flex-col xe:gap-px">
        <NavLink href={adminRoutes.settings(basePath)} icon={RiSettings3Line} active={isActive(adminRoutes.settings(basePath))} onNavigate={onNavigate}>
          Settings
        </NavLink>
      </div>
    </nav>
  );
}

/** Product and scope: the mark, the name, and the site this admin edits. */
function Brand() {
  const { basePath } = useAdmin();
  const [host, setHost] = useState("");
  useEffect(() => setHost(window.location.host), []);
  return (
    <Link href={adminRoutes.dashboard(basePath)} className="xe:flex xe:min-w-0 xe:items-center xe:gap-2.5 xe:rounded-md xe:px-1.5 xe:py-1 xe:transition-colors xe:hover:bg-sidebar-accent/60">
      <ElementMark className="xe:size-7 xe:rounded-[6px] xe:text-[12.5px]" />
      <span className="xe:flex xe:min-w-0 xe:flex-col">
        <span className="xe:text-sm xe:font-semibold xe:leading-tight xe:tracking-[-0.01em]">Xenon</span>
        <span className="xe:truncate xe:text-xs xe:leading-tight xe:text-muted-foreground" suppressHydrationWarning>{host || "Content"}</span>
      </span>
    </Link>
  );
}

function SearchButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="xe:flex xe:h-8 xe:w-full xe:items-center xe:gap-2 xe:rounded-md xe:border xe:border-border xe:bg-background xe:px-2.5 xe:text-sm xe:text-muted-foreground xe:transition-colors xe:hover:border-input xe:hover:text-foreground"
    >
      <RiSearchLine className="xe:size-4" />
      <span className="xe:flex-1 xe:text-left">Search</span>
      <Kbd className="xe:hidden xe:sm:inline-flex">⌘K</Kbd>
    </button>
  );
}

function UserMenu() {
  const { user, basePath } = useAdmin();
  const { theme, setTheme, run } = useAdminRuntime();
  const router = useRouter();

  async function signOut() {
    await run({ type: "auth.logout" });
    router.replace(adminRoutes.login(basePath));
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="xe:flex xe:w-full xe:items-center xe:gap-2.5 xe:rounded-md xe:p-1.5 xe:text-left xe:transition-colors xe:hover:bg-sidebar-accent/60 xe:data-[popup-open]:bg-sidebar-accent"
          />
        }
      >
        <Avatar className="xe:size-7">
          <AvatarFallback className="xe:bg-brand-soft xe:text-[11px] xe:font-semibold xe:text-brand">{initials(user.name, user.email)}</AvatarFallback>
        </Avatar>
        <span className="xe:min-w-0 xe:flex-1">
          <span className="xe:block xe:truncate xe:text-[13px] xe:font-medium xe:leading-tight">{user.name || user.email}</span>
          <span className="xe:block xe:truncate xe:text-xs xe:leading-tight xe:text-muted-foreground">{user.role === "admin" ? "Admin" : "Editor"}</span>
        </span>
        <RiArrowUpDownLine className="xe:size-3.5 xe:text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="xe:w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="xe:font-normal">
            <span className="xe:block xe:text-sm xe:font-medium xe:text-foreground">{user.name || "Signed in"}</span>
            <span className="xe:block xe:truncate xe:text-xs xe:text-muted-foreground">{user.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push(adminRoutes.settings(basePath))}>
          <RiUserLine /> Profile & security
        </DropdownMenuItem>
        {user.role === "admin" ? (
          <DropdownMenuItem onClick={() => router.push(adminRoutes.settings(basePath, "team"))}>
            <RiTeamLine /> Team
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as AdminTheme)}>
            <DropdownMenuRadioItem value="light">
              <RiSunLine /> Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <RiMoonLine /> Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <RiComputerLine /> System
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut}>
          <RiLogoutBoxRLine /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarContents({ onNavigate, onSearch }: { onNavigate?: () => void; onSearch: () => void }) {
  return (
    <>
      <div className="xe:flex xe:h-14 xe:items-center xe:px-3">
        <Brand />
      </div>
      <div className="xe:px-3 xe:pb-3">
        <SearchButton onOpen={onSearch} />
      </div>
      <SidebarNav onNavigate={onNavigate} />
      <div className="xe:px-3 xe:pb-3">
        <UserMenu />
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- top bar */

/** Teammates online right now, and what each is doing. Hidden when you're alone. */
function TeamPresence() {
  const { user, basePath, collections } = useAdmin();
  const { snapshot } = usePresence();
  const pathname = usePathname();
  // People on the open document are shown by the editor itself; list everyone else here.
  const [, docCollection, docId] = pathname.slice(`${basePath}/collections`.length).split("/");
  const onThisDoc = (p: PresencePeer) => pathname.startsWith(`${basePath}/collections/`) && !!docId && p.location?.collection === docCollection && p.location?.id === docId;
  const people = dedupe((snapshot?.peers ?? []).filter((p) => p.user.id !== user.id && !onThisDoc(p)));
  if (!people.length) return null;
  const where = (p: PresencePeer) => {
    const c = p.location ? collections.find((col) => col.slug === p.location!.collection) : undefined;
    if (!p.location || !c) return { label: "Overview", href: adminRoutes.dashboard(basePath) };
    if (!p.location.id) return { label: `Browsing ${c.labels.plural.toLowerCase()}`, href: adminRoutes.list(basePath, c.slug) };
    const title = p.location.title?.trim() || `an untitled ${c.labels.singular.toLowerCase()}`;
    return { label: `${p.editing ? "Editing" : "Viewing"} ${title}`, href: adminRoutes.edit(basePath, c.slug, p.location.id) };
  };
  return (
    <Popover>
      <PopoverTrigger
        render={<button type="button" aria-label={`${people.length} ${people.length === 1 ? "teammate" : "teammates"} online`} className="xe:flex xe:h-8 xe:items-center xe:rounded-md xe:px-1.5 xe:transition-colors xe:hover:bg-sidebar-accent/60" />}
      >
        <AvatarStack peers={people} max={4} ringClass="xe:ring-frame" />
      </PopoverTrigger>
      <PopoverContent align="end" className="xe:w-80 xe:gap-1 xe:p-1.5">
        <p className="xe:px-2 xe:pt-1 xe:pb-1.5 xe:text-xs xe:text-muted-foreground">Online now</p>
        <ul className="xe:flex xe:flex-col">
          {people.map((p) => {
            const w = where(p);
            return (
              <li key={p.user.id}>
                <Link href={w.href} className="xe:flex xe:items-center xe:gap-2.5 xe:rounded-md xe:px-2 xe:py-1.5 xe:transition-colors xe:hover:bg-muted">
                  <PersonAvatar user={p.user} editing={p.editing} />
                  <span className="xe:min-w-0 xe:flex-1">
                    <span className="xe:block xe:truncate xe:text-[13px] xe:font-medium">{displayName(p.user)}</span>
                    <span className="xe:block xe:truncate xe:text-xs xe:text-muted-foreground">{w.label}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** Where you are when a page doesn't say: derived from the route. */
function useDefaultCrumbs(): Crumb[] {
  const { basePath, collections } = useAdmin();
  const pathname = usePathname();
  if (pathname.startsWith(adminRoutes.settings(basePath))) return [{ label: "Settings" }];
  const c = collections.find((col) => pathname.startsWith(adminRoutes.list(basePath, col.slug)));
  if (c) return [{ label: c.admin.group ?? (c.upload ? "Library" : "Content") }, { label: c.labels.plural }];
  return [{ label: "Overview" }];
}

function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="xe:flex xe:min-w-0 xe:items-center xe:gap-1 xe:text-sm">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <Fragment key={`${c.label}-${i}`}>
            {i > 0 ? <RiArrowRightSLine className="xe:hidden xe:size-4 xe:shrink-0 xe:text-muted-foreground/70 xe:sm:block" aria-hidden /> : null}
            {c.href && !last ? (
              <Link href={c.href} className="xe:hidden xe:shrink-0 xe:rounded-sm xe:px-1 xe:text-muted-foreground xe:transition-colors xe:hover:text-foreground xe:sm:inline">
                {c.label}
              </Link>
            ) : (
              <span aria-current={last ? "page" : undefined} className={cn("xe:truncate xe:px-1", last ? "xe:font-medium xe:text-foreground" : "xe:hidden xe:text-muted-foreground xe:sm:inline")}>
                {c.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const bar = useShellBarContent();
  const fallback = useDefaultCrumbs();
  const crumbs = bar?.crumbs?.length ? bar.crumbs : fallback;
  return (
    <header className="xe:sticky xe:top-0 xe:z-30 xe:flex xe:h-12 xe:shrink-0 xe:items-center xe:gap-3 xe:bg-frame xe:pr-3 xe:pl-2 xe:lg:static xe:lg:pr-4 xe:lg:pl-1">
      <Button variant="ghost" size="icon" className="xe:lg:hidden" onClick={onMenu} aria-label="Open navigation">
        <RiMenuLine />
      </Button>
      <div className="xe:min-w-0 xe:flex-1">
        <Breadcrumbs crumbs={crumbs} />
      </div>
      <div className="xe:flex xe:shrink-0 xe:items-center xe:gap-3">
        <TeamPresence />
        {bar?.status}
        {bar?.actions ?? (
          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            className="xe:inline-flex xe:h-8 xe:items-center xe:gap-1 xe:rounded-md xe:px-2 xe:text-sm xe:text-muted-foreground xe:transition-colors xe:hover:bg-sidebar-accent/60 xe:hover:text-foreground"
          >
            View site
            <RiArrowRightUpLine className="xe:size-4" />
          </a>
        )}
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- shell */

/**
 * Signed-in layout. Desktop: a tinted frame (sidebar + 48px top bar, no rule between them) around a
 * white sheet inset 8px from the window's right and bottom edges; the sheet is the scroll container.
 * Phone and tablet: the frame folds away, the sheet is the screen, and the sidebar opens as a drawer.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="xe:flex xe:min-h-dvh xe:bg-frame xe:lg:h-dvh xe:lg:overflow-hidden">
      <aside className="xe:hidden xe:w-[232px] xe:shrink-0 xe:flex-col xe:bg-sidebar xe:text-sidebar-foreground xe:lg:flex">
        <SidebarContents onSearch={() => setPaletteOpen(true)} />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="xe:flex xe:w-72 xe:flex-col xe:gap-0 xe:bg-sidebar xe:p-0" showCloseButton={false}>
          <SheetTitle className="xe:sr-only">Navigation</SheetTitle>
          <SidebarContents onNavigate={() => setMobileOpen(false)} onSearch={() => { setMobileOpen(false); setPaletteOpen(true); }} />
        </SheetContent>
      </Sheet>

      <div className="xe:flex xe:min-w-0 xe:flex-1 xe:flex-col">
        <TopBar onMenu={() => setMobileOpen(true)} />
        <main
          id="xe-sheet"
          className="xe:flex-1 xe:bg-background xe:lg:mr-2 xe:lg:mb-2 xe:lg:overflow-y-auto xe:lg:rounded-[var(--radius-sheet)] xe:lg:border xe:lg:border-border xe:lg:[scrollbar-width:thin]"
        >
          <div className="xe:mx-auto xe:w-full xe:max-w-[1200px] xe:px-4 xe:pt-6 xe:pb-12 xe:sm:px-6 xe:lg:px-8 xe:lg:pt-7 xe:has-[[data-xe-full]]:max-w-none xe:has-[[data-xe-full]]:p-0">{children}</div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
