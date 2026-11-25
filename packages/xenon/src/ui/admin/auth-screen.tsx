"use client";
import { RiErrorWarningLine, RiEyeLine, RiEyeOffLine } from "@remixicon/react";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "../components/button";
import { Field, FieldDescription, FieldLabel } from "../components/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "../components/input-group";
import { Input } from "../components/input";
import { Spinner } from "../components/spinner";
import { useAdminRouter } from "../shared/router";
import { adminRoutes } from "../shared/services";
import { ElementTile, Wordmark } from "./brand";
import { useAdminRuntime } from "./runtime";

declare const __XENON_VERSION__: string;
const XENON_VERSION = typeof __XENON_VERSION__ === "string" ? __XENON_VERSION__ : "dev";

/** Sign-in, or first-run "create your admin account". */
export function AuthScreen({ mode }: { mode: "login" | "setup" }) {
  const { run, basePath } = useAdminRuntime();
  const router = useAdminRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const setup = mode === "setup";
  const [host, setHost] = useState("");
  useEffect(() => setHost(window.location.host), []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const get = (k: string) => String(form.get(k) ?? "");
    setPending(true);
    setError(null);
    const result = setup
      ? await run({ type: "auth.setup", name: get("name"), email: get("email"), password: get("password") })
      : await run({ type: "auth.login", email: get("email"), password: get("password") });
    if (!result.ok) {
      setPending(false);
      setError(result.error.code === "INVALID_EMAIL_OR_PASSWORD" ? "That email and password don't match. Please try again." : result.error.message);
      return;
    }
    router.replace(adminRoutes.dashboard(basePath));
    router.refresh();
  }

  return (
    <div className="xe:flex xe:min-h-dvh xe:bg-frame">
      {/* The frame: Xenon's element tile and what this admin is for. */}
      <aside className="xe:hidden xe:w-[40%] xe:max-w-[560px] xe:flex-col xe:justify-between xe:p-10 xe:lg:flex">
        <ElementTile />
        <div className="xe:flex xe:flex-col xe:gap-3">
          <p className="xe:max-w-sm xe:text-[22px] xe:leading-[1.35] xe:font-medium xe:tracking-[-0.01em] xe:text-foreground">
            Write, review and publish the content behind <span suppressHydrationWarning>{host || "your site"}</span>.
          </p>
          <p className="xe:text-sm xe:text-muted-foreground">Xenon{XENON_VERSION === "dev" ? "" : ` ${XENON_VERSION}`} · content lives in your codebase, edits go live without a deploy.</p>
        </div>
      </aside>

      {/* The sheet. */}
      <div className="xe:flex xe:flex-1 xe:flex-col xe:bg-background xe:lg:my-2 xe:lg:mr-2 xe:lg:rounded-[var(--radius-sheet)] xe:lg:border xe:lg:border-border">
        <header className="xe:flex xe:h-16 xe:items-center xe:px-6 xe:lg:hidden">
          <Wordmark />
        </header>
        <main className="xe:mx-auto xe:flex xe:w-full xe:max-w-[23rem] xe:flex-1 xe:flex-col xe:justify-center xe:px-6 xe:pb-16 xe:lg:px-0">
          <div className="xe:mb-8 xe:flex xe:flex-col xe:gap-2">
            <h1 className="xe:text-2xl xe:font-semibold xe:leading-tight xe:tracking-[-0.015em]">
              {setup ? "Set up your workspace" : "Sign in"}
            </h1>
            <p className="xe:text-sm xe:text-muted-foreground">
              {setup ? "Create the first admin account. You can invite editors afterwards." : "Use the email and password your admin set up for you."}
            </p>
          </div>

          <form onSubmit={onSubmit} className="xe:flex xe:flex-col xe:gap-5">
            {error && (
              <p role="alert" className="xe:flex xe:items-start xe:gap-2 xe:rounded-md xe:bg-pill-changed xe:px-3 xe:py-2.5 xe:text-sm xe:text-destructive xe:dark:bg-destructive/10">
                <RiErrorWarningLine className="xe:mt-0.5 xe:size-4 xe:shrink-0" />
                {error}
              </p>
            )}
            {setup && (
              <Field>
                <FieldLabel htmlFor="xe-name">Name</FieldLabel>
                <Input id="xe-name" name="name" autoComplete="name" required autoFocus className="xe:h-10" />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="xe-email">Email</FieldLabel>
              <Input id="xe-email" name="email" type="email" autoComplete="email" required autoFocus={!setup} className="xe:h-10" />
            </Field>
            <Field>
              <FieldLabel htmlFor="xe-password">Password</FieldLabel>
              <InputGroup className="xe:h-10">
                <InputGroupInput
                  id="xe-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={setup ? "new-password" : "current-password"}
                  required
                  minLength={setup ? 8 : undefined}
                  aria-describedby={setup ? "xe-password-hint" : undefined}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton size="icon-xs" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((v) => !v)}>
                    {showPassword ? <RiEyeOffLine /> : <RiEyeLine />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              {setup && <FieldDescription id="xe-password-hint">At least 8 characters.</FieldDescription>}
            </Field>
            <Button type="submit" className="xe:mt-1 xe:h-10 xe:w-full" disabled={pending}>
              {pending && <Spinner className="xe:size-4" />}
              {pending ? (setup ? "Creating account…" : "Signing in…") : setup ? "Create admin account" : "Sign in"}
            </Button>
          </form>
        </main>
      </div>
    </div>
  );
}
