"use client";
import {
  RiAddLine,
  RiArrowUpDownLine,
  RiComputerLine,
  RiDashboardLine,
  RiFileTextLine,
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
import { type ComponentType, type ReactNode, useEffect, useState } from "react";
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
import { Sheet, SheetContent, SheetTitle } from "../components/sheet";
import { cn } from "../lib/utils";
import { useAdmin } from "../shared/admin-context";
import type { ClientCollection } from "../shared/client-config";
import { adminRoutes } from "../shared/services";
import { Wordmark } from "./auth-screen";
import { CommandPalette } from "./command-palette";
import { initials } from "./format";
import { type AdminTheme, useAdminRuntime } from "./runtime";

type Icon = ComponentType<{ className?: string }>;

export function collectionIcon(c: ClientCollection): Icon {
  return c.upload ? RiImageLine : RiFileTextLine;
}

function NavLink({ href, icon: Icon, children, active, onNavigate }: { href: string; icon: Icon; children: ReactNode; active: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "xe:group xe:flex xe:h-8 xe:items-center xe:gap-2.5 xe:rounded-md xe:px-2.5 xe:text-[13.5px] xe:font-medium xe:transition-colors",
        active
          ? "xe:bg-sidebar-accent xe:text-sidebar-accent-foreground"
          : "xe:text-sidebar-foreground/80 xe:hover:bg-sidebar-accent/60 xe:hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className={cn("xe:size-[18px] xe:shrink-0", active ? "xe:text-foreground" : "xe:text-muted-foreground xe:group-hover:text-foreground")} />
      <span className="xe:truncate">{children}</span>
    </Link>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { basePath, collections, user } = useAdmin();
  const pathname = usePathname();
  const isActive = (href: string, exact = false) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  const groups = new Map<string, ClientCollection[]>();
  for (const c of collections) {
    const group = c.admin.group ?? (c.upload ? "Media" : "Content");
    groups.set(group, [...(groups.get(group) ?? []), c]);
  }

  return (
    <nav className="xe:flex xe:flex-1 xe:flex-col xe:gap-6 xe:overflow-y-auto xe:px-3 xe:py-4" aria-label="Main">
      <div className="xe:flex xe:flex-col xe:gap-0.5">
        <NavLink href={adminRoutes.dashboard(basePath)} icon={RiDashboardLine} active={isActive(adminRoutes.dashboard(basePath), true)} onNavigate={onNavigate}>
          Dashboard
        </NavLink>
      </div>
      {[...groups].map(([group, items]) => (
        <div key={group} className="xe:flex xe:flex-col xe:gap-0.5">
          <p className="xe:px-2.5 xe:pb-1 xe:text-xs xe:font-medium xe:text-muted-foreground">{group}</p>
          {items.map((c) => (
            <NavLink key={c.slug} href={adminRoutes.list(basePath, c.slug)} icon={collectionIcon(c)} active={isActive(adminRoutes.list(basePath, c.slug))} onNavigate={onNavigate}>
              {c.labels.plural}
            </NavLink>
          ))}
        </div>
      ))}
      <div className="xe:mt-auto xe:flex xe:flex-col xe:gap-0.5">
        <NavLink href={adminRoutes.settings(basePath)} icon={RiSettings3Line} active={isActive(adminRoutes.settings(basePath))} onNavigate={onNavigate}>
          Settings
        </NavLink>
      </div>
    </nav>
  );
}

function Brand() {
  const { basePath } = useAdmin();
  return (
    <Link href={adminRoutes.dashboard(basePath)} className="xe:flex xe:items-center xe:gap-2.5 xe:rounded-md xe:px-1 xe:py-1">
      <Wordmark />
    </Link>
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
            className="xe:flex xe:w-full xe:items-center xe:gap-2.5 xe:rounded-md xe:p-2 xe:text-left xe:transition-colors xe:hover:bg-sidebar-accent/70 xe:data-[popup-open]:bg-sidebar-accent"
          />
        }
      >
        <Avatar className="xe:size-8">
          <AvatarFallback className="xe:bg-muted xe:text-xs xe:font-semibold xe:text-foreground">{initials(user.name, user.email)}</AvatarFallback>
        </Avatar>
        <span className="xe:min-w-0 xe:flex-1">
          <span className="xe:block xe:truncate xe:text-[13px] xe:font-medium">{user.name || user.email}</span>
          <span className="xe:block xe:truncate xe:text-xs xe:text-muted-foreground">{user.role === "admin" ? "Admin" : "Editor"}</span>
        </span>
        <RiArrowUpDownLine className="xe:size-4 xe:text-muted-foreground" />
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

function SidebarContents({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <div className="xe:flex xe:h-14 xe:items-center xe:px-4">
        <Brand />
      </div>
      <SidebarNav onNavigate={onNavigate} />
      <div className="xe:border-t xe:border-sidebar-border xe:p-2">
        <UserMenu />
      </div>
    </>
  );
}

/** Signed-in layout: sidebar, top bar with search (⌘K), content area. */
export function AdminShell({ children }: { children: ReactNode }) {
  const { collections, basePath } = useAdmin();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const pathname = usePathname();
  const current = collections.find((c) => pathname.startsWith(adminRoutes.list(basePath, c.slug)));

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
    <div className="xe:flex xe:min-h-dvh">
      <aside className="xe:sticky xe:top-0 xe:hidden xe:h-dvh xe:w-64 xe:shrink-0 xe:flex-col xe:border-r xe:border-sidebar-border xe:bg-sidebar xe:text-sidebar-foreground xe:lg:flex">
        <SidebarContents />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="xe:flex xe:w-72 xe:flex-col xe:gap-0 xe:bg-sidebar xe:p-0" showCloseButton={false}>
          <SheetTitle className="xe:sr-only">Navigation</SheetTitle>
          <SidebarContents onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="xe:flex xe:min-w-0 xe:flex-1 xe:flex-col">
        <header className="xe:sticky xe:top-0 xe:z-30 xe:flex xe:h-14 xe:items-center xe:gap-3 xe:border-b xe:border-border xe:bg-background/85 xe:px-4 xe:backdrop-blur-md xe:sm:px-6">
          <Button variant="ghost" size="icon" className="xe:lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <RiMenuLine />
          </Button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="xe:flex xe:h-9 xe:w-full xe:max-w-sm xe:items-center xe:gap-2 xe:rounded-lg xe:border xe:border-input xe:bg-card xe:px-3 xe:text-sm xe:text-muted-foreground xe:shadow-xs xe:transition-colors xe:hover:border-foreground/20 xe:hover:text-foreground"
          >
            <RiSearchLine className="xe:size-4" />
            <span className="xe:flex-1 xe:text-left">Search or jump to…</span>
            <Kbd className="xe:hidden xe:sm:inline-flex">⌘K</Kbd>
          </button>
          <div className="xe:ml-auto">
            {current && (
              <Link
                href={adminRoutes.create(basePath, current.slug)}
                className="xe:inline-flex xe:h-9 xe:items-center xe:gap-1.5 xe:rounded-lg xe:bg-primary xe:px-3.5 xe:text-sm xe:font-medium xe:text-primary-foreground xe:shadow-sm xe:transition-colors xe:hover:bg-primary/90"
              >
                <RiAddLine className="xe:size-4" />
                <span className="xe:hidden xe:sm:inline">New {current.labels.singular.toLowerCase()}</span>
              </Link>
            )}
          </div>
        </header>
        <main className="xe:mx-auto xe:w-full xe:max-w-6xl xe:flex-1 xe:px-4 xe:py-8 xe:sm:px-6 xe:lg:px-10">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
