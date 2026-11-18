"use client";
import { RiCheckLine, RiComputerLine, RiLogoutBoxRLine, RiPaletteLine, RiSmartphoneLine, RiTeamLine, RiUserLine } from "@remixicon/react";
import Link from "next/link";
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
    <div className="xe:flex xe:flex-col xe:gap-8">
      <header className="xe:flex xe:flex-col xe:gap-1">
        <h1 className="xe:text-2xl xe:font-semibold xe:tracking-tight">Settings</h1>
        <p className="xe:text-muted-foreground">Manage your profile, how the admin looks{user.role === "admin" ? ", and who's on your team" : ""}.</p>
      </header>
      <div className="xe:grid xe:items-start xe:gap-8 xe:md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Settings" className="xe:-mx-1 xe:flex xe:gap-1 xe:overflow-x-auto xe:px-1 xe:md:sticky xe:md:top-22 xe:md:mx-0 xe:md:flex-col xe:md:px-0">
          {tabs.map((t) => (
            <Link
              key={t.id}
              href={adminRoutes.settings(basePath, t.id)}
              aria-current={t.id === tab ? "page" : undefined}
              className={cn(
                "xe:flex xe:h-9 xe:shrink-0 xe:items-center xe:gap-2.5 xe:rounded-md xe:px-3 xe:text-sm xe:font-medium xe:transition-colors",
                t.id === tab ? "xe:bg-accent xe:text-foreground" : "xe:text-muted-foreground xe:hover:bg-accent/60 xe:hover:text-foreground",
              )}
            >
              <t.icon className="xe:size-4" />
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="xe:flex xe:min-w-0 xe:max-w-3xl xe:flex-col xe:gap-6">
          {tab === "profile" ? <ProfileSettings sessions={sessions} /> : tab === "appearance" ? <AppearanceSettings /> : <UsersView users={users} />}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- building blocks */

function Section({ title, description, children, footer, onSubmit, danger }: {
  title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; onSubmit?: (e: FormEvent<HTMLFormElement>) => void; danger?: boolean;
}) {
  const body = (
    <>
      <div className="xe:flex xe:flex-col xe:gap-1 xe:px-6 xe:pt-5">
        <h2 className="xe:text-[15px] xe:font-semibold">{title}</h2>
        {description ? <p className="xe:text-sm xe:text-muted-foreground">{description}</p> : null}
      </div>
      <div className="xe:px-6 xe:py-5">{children}</div>
      {footer ? <div className="xe:flex xe:items-center xe:justify-end xe:gap-2 xe:rounded-b-lg xe:border-t xe:border-border xe:bg-muted/40 xe:px-6 xe:py-3">{footer}</div> : null}
    </>
  );
  const className = cn("xe:rounded-lg xe:border xe:bg-card xe:shadow-xs", danger ? "xe:border-destructive/30" : "xe:border-border");
  return onSubmit ? <form onSubmit={onSubmit} className={className}>{body}</form> : <section className={className}>{body}</section>;
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
            <AvatarFallback className="xe:bg-muted xe:text-base xe:font-semibold xe:text-foreground">{initials(name || user.name, user.email)}</AvatarFallback>
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
              <span className="xe:grid xe:size-9 xe:shrink-0 xe:place-items-center xe:rounded-md xe:border xe:border-border xe:bg-background">
                <DeviceIcon className="xe:size-4 xe:text-muted-foreground" />
              </span>
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
  const bg = dark ? "oklch(0.155 0 0)" : "oklch(0.992 0 0)";
  const side = dark ? "oklch(0.17 0 0)" : "oklch(0.965 0 0)";
  const line = dark ? "oklch(0.32 0 0)" : "oklch(0.88 0 0)";
  const ink = dark ? "oklch(0.85 0 0)" : "oklch(0.25 0 0)";
  return (
    <svg viewBox="0 0 120 72" className="xe:h-full xe:w-full" aria-hidden>
      <rect width="120" height="72" fill={bg} />
      <rect width="30" height="72" fill={side} />
      <rect x="6" y="8" width="16" height="4" rx="2" fill={ink} />
      <rect x="6" y="20" width="18" height="3" rx="1.5" fill={line} />
      <rect x="6" y="28" width="14" height="3" rx="1.5" fill={line} />
      <rect x="40" y="10" width="40" height="5" rx="2.5" fill={ink} />
      <rect x="40" y="22" width="70" height="3" rx="1.5" fill={line} />
      <rect x="40" y="30" width="62" height="3" rx="1.5" fill={line} />
      <rect x="40" y="38" width="66" height="3" rx="1.5" fill={line} />
      <rect x="40" y="52" width="22" height="9" rx="2.5" fill={ink} />
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
                selected ? "xe:border-foreground xe:ring-1 xe:ring-foreground" : "xe:border-border xe:hover:border-foreground/40",
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
                {selected ? <RiCheckLine className="xe:size-4 xe:shrink-0" aria-hidden /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}
