"use client";
import { RiDeleteBinLine, RiKeyLine, RiMoreLine, RiUserAddLine } from "@remixicon/react";
import { type FormEvent, useState } from "react";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "../components/dropdown-menu";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "../components/field";
import { Input } from "../components/input";
import { Spinner } from "../components/spinner";
import { useAdmin } from "../shared/admin-context";
import type { AdminUserInfo } from "../shared/services";
import { initials, timeAgo } from "./format";
import { useAdminRuntime } from "./runtime";

type Role = AdminUserInfo["role"];
export type TeamMember = AdminUserInfo & { createdAt: string };

const ROLE_HELP: Record<Role, string> = {
  admin: "Full access, including managing the team.",
  editor: "Can create, edit and publish content.",
};

export function UsersView({ users }: { users: TeamMember[] }) {
  const { user: me } = useAdmin();
  const { run } = useAdminRuntime();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [role, setRole] = useState<Role>("editor");
  const [passwordFor, setPasswordFor] = useState<TeamMember | null>(null);
  const [removing, setRemoving] = useState<TeamMember | null>(null);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    const res = await run(
      { type: "users.create", name: String(form.get("name")), email: String(form.get("email")), password: String(form.get("password")), role },
      { refresh: true },
    );
    setPending(false);
    if (!res.ok) return void toast.error(res.error.message);
    toast.success("Team member added. Share their password with them securely.");
    setInviteOpen(false);
  }

  async function changeRole(u: TeamMember, next: Role) {
    const res = await run({ type: "users.setRole", userId: u.id, role: next }, { refresh: true });
    if (res.ok) toast.success(`${u.name || u.email} is now ${next === "admin" ? "an admin" : "an editor"}.`);
    else toast.error(res.error.message);
  }

  async function setPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!passwordFor) return;
    const form = new FormData(e.currentTarget);
    setPending(true);
    const res = await run({ type: "users.setPassword", userId: passwordFor.id, password: String(form.get("password")) });
    setPending(false);
    if (!res.ok) return void toast.error(res.error.message);
    toast.success("Password updated.");
    setPasswordFor(null);
  }

  async function remove() {
    if (!removing) return;
    const res = await run({ type: "users.remove", userId: removing.id }, { refresh: true });
    if (res.ok) toast.success("Team member removed.");
    else toast.error(res.error.message);
    setRemoving(null);
  }

  return (
    <section className="xe:rounded-lg xe:border xe:border-border xe:bg-card xe:shadow-xs">
      <header className="xe:flex xe:flex-wrap xe:items-start xe:justify-between xe:gap-4 xe:border-b xe:border-border xe:px-6 xe:py-5">
        <div className="xe:flex xe:flex-col xe:gap-1">
          <h2 className="xe:text-[15px] xe:font-semibold">Team</h2>
          <p className="xe:text-sm xe:text-muted-foreground">
            {users.length === 1 ? "1 person" : `${users.length} people`} can sign in. Admins manage the team; editors work on content.
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <RiUserAddLine data-icon="inline-start" /> Add member
        </Button>
      </header>

      <div className="xe:divide-y xe:divide-border">
        {users.map((u) => (
          <div key={u.id} className="xe:flex xe:items-center xe:gap-4 xe:px-6 xe:py-3.5">
            <Avatar className="xe:size-9">
              <AvatarFallback className="xe:bg-muted xe:text-xs xe:font-semibold xe:text-foreground">{initials(u.name, u.email)}</AvatarFallback>
            </Avatar>
            <div className="xe:min-w-0 xe:flex-1">
              <p className="xe:truncate xe:font-medium">
                {u.name || u.email} {u.id === me.id && <span className="xe:text-sm xe:font-normal xe:text-muted-foreground">(you)</span>}
              </p>
              <p className="xe:truncate xe:text-sm xe:text-muted-foreground">
                {u.email} · joined {timeAgo(u.createdAt)}
              </p>
            </div>
            <Badge variant={u.role === "admin" ? "outline" : "secondary"}>{u.role === "admin" ? "Admin" : "Editor"}</Badge>
            {u.id !== me.id && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Options for ${u.email}`} />}>
                  <RiMoreLine />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="xe:w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Role</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={u.role} onValueChange={(v) => changeRole(u, v as Role)}>
                      <DropdownMenuRadioItem value="admin">Admin</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="editor">Editor</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setPasswordFor(u)}>
                    <RiKeyLine /> Set new password
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => setRemoving(u)}>
                    <RiDeleteBinLine /> Remove from team
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="xe:sm:max-w-md">
          <form onSubmit={create}>
            <DialogHeader>
              <DialogTitle>Add a team member</DialogTitle>
              <DialogDescription>They can sign in right away with the email and password you set.</DialogDescription>
            </DialogHeader>
            <FieldGroup className="xe:py-5">
              <Field>
                <FieldLabel htmlFor="xe-u-name">Name</FieldLabel>
                <Input id="xe-u-name" name="name" required autoFocus />
              </Field>
              <Field>
                <FieldLabel htmlFor="xe-u-email">Email</FieldLabel>
                <Input id="xe-u-email" name="email" type="email" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="xe-u-password">Temporary password</FieldLabel>
                <Input id="xe-u-password" name="password" type="text" minLength={8} required autoComplete="off" />
                <FieldDescription>At least 8 characters. They can change it from their account page.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Role</FieldLabel>
                <div className="xe:grid xe:grid-cols-2 xe:gap-2" role="radiogroup">
                  {(["editor", "admin"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={role === r}
                      onClick={() => setRole(r)}
                      className="xe:rounded-lg xe:border xe:border-input xe:p-3 xe:text-left xe:transition-colors xe:hover:bg-muted/60 xe:aria-checked:border-primary xe:aria-checked:bg-accent xe:aria-checked:ring-1 xe:aria-checked:ring-primary"
                    >
                      <span className="xe:block xe:text-sm xe:font-medium">{r === "admin" ? "Admin" : "Editor"}</span>
                      <span className="xe:block xe:text-xs xe:text-muted-foreground">{ROLE_HELP[r]}</span>
                    </button>
                  ))}
                </div>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Spinner className="xe:size-4" />} Add member
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!passwordFor} onOpenChange={(o) => !o && setPasswordFor(null)}>
        <DialogContent className="xe:sm:max-w-md">
          <form onSubmit={setPassword}>
            <DialogHeader>
              <DialogTitle>Set a new password</DialogTitle>
              <DialogDescription>For {passwordFor?.email}.</DialogDescription>
            </DialogHeader>
            <FieldGroup className="xe:py-5">
              <Field>
                <FieldLabel htmlFor="xe-u-newpass">New password</FieldLabel>
                <Input id="xe-u-newpass" name="password" type="text" minLength={8} required autoFocus autoComplete="off" />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPasswordFor(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                Save password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name || removing?.email}?</AlertDialogTitle>
            <AlertDialogDescription>They'll lose access immediately. Their content stays.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
