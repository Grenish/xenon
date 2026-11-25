"use client";
import { RiCheckLine, RiComputerLine, RiLogoutBoxRLine, RiPaletteLine, RiSmartphoneLine, RiTeamLine, RiUserLine } from "@remixicon/react";
import { type ComponentType, type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/alert-dialog";
import { Avatar, AvatarFallback } from "../components/avatar";
import { Badge } from "../components/badge";
import { Button } from "../components/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "../components/field";
import { Input } from "../components/input";
import { Spinner } from "../components/spinner";
import { cn } from "../lib/utils";
import { useAdmin } from "../shared/admin-context";
import { AdminLink as Link } from "../shared/router";
import { type AccountSession, adminRoutes, type SettingsTab } from "../shared/services";
import { formatDate, initials, timeAgo } from "./format";
import { type AdminTheme, useAdminRuntime } from "./runtime";
import { type TeamMember, UsersView } from "./users";

type Icon = ComponentType<{ className?: string }>;

const TABS: { id: SettingsTab; label: string; icon: Icon; adminOnly?: boolean }[] = [
  { id: "profile", label: "Profile & security", icon: RiUserLine },
  { id: "appearance", label: "Appearance", icon: RiPaletteLine },
  { id: "team", label: "Team", icon: RiTeamLine, adminOnly: true },
];

export function SettingsView({ tab, users, sessions }: { tab: SettingsTab; users: TeamMember[]; sessions: AccountSession[] }) {
  const { basePath, user } = useAdmin();
  const tabs = TABS.filter((t) => !t.adminOnly || user.role === "admin");
  return (
    <div className="xe:flex xe:flex-col xe:gap-5">
      <header className="xe:flex xe:flex-col xe:gap-1">
        <h1 className="xe:text-[22px] xe:font-semibold xe:leading-tight xe:tracking-[-0.01em]">Settings</h1>
        <p className="xe:text-sm xe:text-muted-foreground">Your profile, how the admin looks{user.role === "admin" ? ", and who can sign in" : ""}.</p>
      </header>
      <nav aria-label="Settings" className="xe:flex xe:gap-5 xe:overflow-x-auto xe:border-b xe:border-border">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={adminRoutes.settings(basePath, t.id)}
            aria-current={t.id === tab ? "page" : undefined}
            className={cn(
              "xe:-mb-px xe:flex xe:h-10 xe:shrink-0 xe:items-center xe:gap-2 xe:border-b-2 xe:text-sm xe:transition-colors",
              t.id === tab ? "xe:border-brand xe:font-medium xe:text-foreground" : "xe:border-transparent xe:text-muted-foreground xe:hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="xe:flex xe:min-w-0 xe:flex-col xe:pt-3">
        {tab === "profile" ? <ProfileSettings sessions={sessions} /> : tab === "appearance" ? <AppearanceSettings /> : <UsersView users={users} />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- building blocks */

/**
 * One settings section is one row: what it is (title + description) on the left, the controls in a
 * tinted panel on the right. Sections are split by a full-width rule.
 */
function Section({ title, description, children, footer, onSubmit, danger }: {
  title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; onSubmit?: (e: FormEvent<HTMLFormElement>) => void; danger?: boolean;
}) {
  const panel = (
    <>
      <div className="xe:p-5">{children}</div>
      {footer ? <div className="xe:flex xe:items-center xe:justify-end xe:gap-2 xe:px-5 xe:pb-5">{footer}</div> : null}
    </>
  );
  const panelClass = cn("xe:min-w-0 xe:rounded-[10px] xe:bg-muted", danger && "xe:ring-1 xe:ring-destructive/30");
  return (
    <section className="xe:grid xe:gap-4 xe:border-b xe:border-border xe:py-8 xe:first:pt-2 xe:last:border-b-0 xe:md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] xe:md:gap-10">
      <div className="xe:flex xe:flex-col xe:gap-1 xe:md:pt-1">
        <h2 className={cn("xe:text-[15px] xe:font-semibold", danger && "xe:text-destructive")}>{title}</h2>
        {description ? <p className="xe:text-sm xe:text-muted-foreground">{description}</p> : null}
      </div>
      {onSubmit ? <form onSubmit={onSubmit} className={panelClass}>{panel}</form> : <div className={panelClass}>{panel}</div>}
    </section>
  );
}

/* ---------------------------------------------------------------- profile & security */

function ProfileSettings({ sessions }: { sessions: AccountSession[] }) {
  const { user } = useAdmin();
  const { run } = useAdminRuntime();
  const [saving, setSaving] = useState<"profile" | "password" | null>(null);
  const [name, setName] = useState(user.name ?? "");

  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving("profile");
    const res = await run({ type: "account.update", name }, { refresh: true });
    setSaving(null);
    if (res.ok) toast.success("Profile saved");
    else toast.error(res.error.message);
  }

  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    if (form.get("newPassword") !== form.get("confirm")) return void toast.error("The new passwords don't match.");
    setSaving("password");
    const res = await run(
      { type: "account.changePassword", currentPassword: String(form.get("currentPassword")), newPassword: String(form.get("newPassword")) },
      { refresh: true },
    );
    setSaving(null);
    if (!res.ok) return void toast.error(res.error.message);
    formEl.reset();
    toast.success("Password changed. Your other sessions were signed out.");
  }

  return (
    <>
      <Section
        title="Profile"
        description="How you appear to your team."
        onSubmit={saveProfile}
        footer={<Button type="submit" disabled={saving === "profile" || !name.trim() || name.trim() === (user.name ?? "")}>{saving === "profile" && <Spinner />}Save changes</Button>}
      >
        <div className="xe:flex xe:flex-col xe:gap-6 xe:sm:flex-row xe:sm:items-start">
          <Avatar className="xe:size-14">
            <AvatarFallback className="xe:bg-brand-soft xe:text-base xe:font-semibold xe:text-brand">{initials(name || user.name, user.email)}</AvatarFallback>
          </Avatar>
          <FieldGroup className="xe:flex-1">
            <Field>
              <FieldLabel htmlFor="xe-acc-name">Name</FieldLabel>
              <Input id="xe-acc-name" name="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="xe-acc-email">Email</FieldLabel>
              <Input id="xe-acc-email" value={user.email} readOnly disabled />
              <FieldDescription>You sign in with this address. Ask an admin if it needs to change.</FieldDescription>
            </Field>
            <div className="xe:flex xe:items-center xe:gap-2 xe:text-sm">
              <span className="xe:text-muted-foreground">Role</span>
              <Badge variant="secondary">{user.role === "admin" ? "Admin" : "Editor"}</Badge>
            </div>
          </FieldGroup>
        </div>
      </Section>

      <Section
        title="Password"
        description="Use at least 8 characters. Changing it signs you out everywhere else."
        onSubmit={changePassword}
        footer={<Button type="submit" disabled={saving === "password"}>{saving === "password" && <Spinner />}Update password</Button>}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="xe-acc-current">Current password</FieldLabel>
            <Input id="xe-acc-current" name="currentPassword" type="password" autoComplete="current-password" required />
          </Field>
          <div className="xe:grid xe:gap-5 xe:sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="xe-acc-new">New password</FieldLabel>
              <Input id="xe-acc-new" name="newPassword" type="password" autoComplete="new-password" minLength={8} required />
            </Field>
            <Field>
              <FieldLabel htmlFor="xe-acc-confirm">Confirm new password</FieldLabel>
              <Input id="xe-acc-confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
            </Field>
          </div>
        </FieldGroup>
      </Section>

      <SessionsSection sessions={sessions} />
    </>
  );
}

function describeAgent(ua: string | null): { label: string; mobile: boolean } {
  if (!ua) return { label: "Unknown device", mobile: false };
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /curl|bun|node/i.test(ua) ? "Script" : "Browser";
  const os = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS"
    : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : null;
  return { label: os ? `${browser} on ${os}` : browser, mobile: /Mobile|iPhone|Android/.test(ua) };
}

function SessionsSection({ sessions }: { sessions: AccountSession[] }) {
  const { run } = useAdminRuntime();
  const [pending, setPending] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const others = sessions.filter((s) => !s.current).length;

  async function revoke(id: string) {
    setPending(id);
    const res = await run({ type: "account.revokeSession", sessionId: id }, { refresh: true });
    setPending(null);
    if (res.ok) toast.success("Session signed out");
    else toast.error(res.error.message);
  }
  async function revokeOthers() {
    setPending("others");
    const res = await run({ type: "account.revokeOtherSessions" }, { refresh: true });
    setPending(null);
    setConfirmAll(false);
    if (res.ok) toast.success("Signed out of all other sessions");
    else toast.error(res.error.message);
  }

  return (
    <Section
      title="Active sessions"
      description="Devices where you're signed in. Sign out any you don't recognize."
      footer={others > 0 ? <Button type="button" variant="outline" onClick={() => setConfirmAll(true)} disabled={pending !== null}><RiLogoutBoxRLine data-icon="inline-start" />Sign out of other sessions</Button> : undefined}
    >
      <ul className="xe:-my-2 xe:divide-y xe:divide-border">
        {sessions.map((s) => {
          const agent = describeAgent(s.userAgent);
          const DeviceIcon = agent.mobile ? RiSmartphoneLine : RiComputerLine;
          return (
            <li key={s.id} className="xe:flex xe:items-center xe:gap-4 xe:py-3">
              <DeviceIcon className="xe:size-5 xe:shrink-0 xe:text-muted-foreground" />
              <div className="xe:min-w-0 xe:flex-1">
                <p className="xe:flex xe:items-center xe:gap-2 xe:text-sm xe:font-medium">
                  {agent.label}
                  {s.current ? <Badge variant="secondary" className="xe:gap-1"><span className="xe:size-1.5 xe:rounded-full xe:bg-success" aria-hidden />This device</Badge> : null}
                </p>
                <p className="xe:truncate xe:text-xs xe:text-muted-foreground" title={`Signed in ${formatDate(s.createdAt)}`}>
                  {[s.ipAddress, s.current ? "Active now" : `Last active ${timeAgo(s.updatedAt)}`].filter(Boolean).join(" · ")}
                </p>
              </div>
              {!s.current ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => void revoke(s.id)} disabled={pending !== null}>
                  {pending === s.id && <Spinner />}Sign out
                </Button>
              ) : null}
            </li>
          );
        })}
        {sessions.length === 0 ? <li className="xe:py-3 xe:text-sm xe:text-muted-foreground">Sessions couldn't be loaded.</li> : null}
      </ul>
      <AlertDialog open={confirmAll} onOpenChange={(open) => { if (pending === null) setConfirmAll(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out of {others === 1 ? "1 other session" : `${others} other sessions`}?</AlertDialogTitle>
            <AlertDialogDescription>You'll stay signed in on this device. Anyone using the other sessions will need to sign in again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void revokeOthers()} disabled={pending !== null}>{pending === "others" && <Spinner />}Sign out</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

/* ---------------------------------------------------------------- appearance */

function ThemePreview({ variant }: { variant: "light" | "dark" }) {
  const dark = variant === "dark";
  const frame = dark ? "#0c0d0f" : "#f1f3f5";
  const sheet = dark ? "#141518" : "#ffffff";
  const edge = dark ? "#25282c" : "#e6e8eb";
  const line = dark ? "#2c2f34" : "#e3e6ea";
  const ink = dark ? "#d9dce0" : "#2a2c30";
  const brand = dark ? "#5fb4c8" : "#1b6c80";
  return (
    <svg viewBox="0 0 120 72" className="xe:h-full xe:w-full" aria-hidden>
      <rect width="120" height="72" fill={frame} />
      <rect x="5" y="5" width="7" height="7" rx="1.5" fill={brand} />
      <rect x="5" y="20" width="18" height="3" rx="1.5" fill={line} />
      <rect x="5" y="27" width="14" height="3" rx="1.5" fill={line} />
      <rect x="5" y="34" width="16" height="3" rx="1.5" fill={line} />
      <rect x="29.5" y="12.5" width="87" height="56" rx="4" fill={sheet} stroke={edge} />
      <rect x="37" y="20" width="34" height="4.5" rx="2" fill={ink} />
      <rect x="37" y="31" width="72" height="4" rx="2" fill={line} />
      <rect x="37" y="31" width="40" height="4" rx="2" fill={brand} />
      <rect x="37" y="42" width="66" height="3" rx="1.5" fill={line} />
      <rect x="37" y="49" width="58" height="3" rx="1.5" fill={line} />
      <rect x="37" y="56" width="62" height="3" rx="1.5" fill={line} />
    </svg>
  );
}

const THEMES: { id: AdminTheme; label: string; description: string }[] = [
  { id: "light", label: "Light", description: "Bright and neutral" },
  { id: "dark", label: "Dark", description: "Easier on the eyes at night" },
  { id: "system", label: "System", description: "Follows your device setting" },
];

function AppearanceSettings() {
  const { theme, setTheme } = useAdminRuntime();
  return (
    <Section title="Theme" description="Choose how the admin looks to you. Saved in this browser.">
      <div role="radiogroup" aria-label="Theme" className="xe:grid xe:gap-4 xe:sm:grid-cols-3">
        {THEMES.map((t) => {
          const selected = theme === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => { setTheme(t.id); toast.success(`${t.label} theme`); }}
              className={cn(
                "xe:group xe:flex xe:flex-col xe:gap-3 xe:rounded-lg xe:border xe:p-2 xe:text-left xe:transition-colors",
                selected ? "xe:border-brand xe:bg-background xe:outline xe:outline-1 xe:outline-brand" : "xe:border-border xe:bg-background xe:hover:border-input",
              )}
            >
              <span className="xe:relative xe:block xe:aspect-[5/3] xe:overflow-hidden xe:rounded-md xe:border xe:border-border">
                {t.id === "system" ? (
                  <>
                    <span className="xe:absolute xe:inset-0"><ThemePreview variant="light" /></span>
                    <span className="xe:absolute xe:inset-0 xe:[clip-path:polygon(100%_0,100%_100%,0_100%)]"><ThemePreview variant="dark" /></span>
                  </>
                ) : (
                  <ThemePreview variant={t.id} />
                )}
              </span>
              <span className="xe:flex xe:items-start xe:justify-between xe:gap-2 xe:px-1 xe:pb-1">
                <span>
                  <span className="xe:block xe:text-sm xe:font-medium">{t.label}</span>
                  <span className="xe:block xe:text-xs xe:text-muted-foreground">{t.description}</span>
                </span>
                {selected ? <RiCheckLine className="xe:size-4 xe:shrink-0 xe:text-brand" aria-hidden /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}
