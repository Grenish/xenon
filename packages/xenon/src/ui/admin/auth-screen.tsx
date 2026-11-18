"use client";
import { RiErrorWarningLine, RiEyeLine, RiEyeOffLine } from "@remixicon/react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "../components/button";
import { Field, FieldDescription, FieldLabel } from "../components/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "../components/input-group";
import { Input } from "../components/input";
import { Spinner } from "../components/spinner";
import { adminRoutes } from "../shared/services";
import { useAdminRuntime } from "./runtime";

declare const __XENON_VERSION__: string;
const XENON_VERSION = typeof __XENON_VERSION__ === "string" ? __XENON_VERSION__ : "dev";

/** Sign-in, or first-run "create your admin account". */
export function AuthScreen({ mode }: { mode: "login" | "setup" }) {
  const { run, basePath } = useAdminRuntime();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const setup = mode === "setup";

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
    <div className="xe:flex xe:min-h-dvh xe:flex-col xe:items-center xe:px-6">
      <header className="xe:flex xe:h-20 xe:items-center">
        <Wordmark />
      </header>

      <main className="xe:flex xe:w-full xe:max-w-[22rem] xe:flex-1 xe:flex-col xe:justify-center xe:pb-20">
        <div className="xe:mb-8 xe:flex xe:flex-col xe:gap-2">
          <h1 className="xe:text-[1.625rem] xe:font-semibold xe:leading-tight xe:tracking-[-0.02em]">
            {setup ? "Set up your workspace" : "Sign in to your workspace"}
          </h1>
          <p className="xe:text-sm xe:text-muted-foreground">
            {setup ? "Create the first admin account. You can add your team afterwards." : "Enter your email and password to continue."}
          </p>
        </div>

        <form onSubmit={onSubmit} className="xe:flex xe:flex-col xe:gap-5">
          {error && (
            <p role="alert" className="xe:flex xe:items-start xe:gap-2 xe:rounded-md xe:bg-destructive/8 xe:px-3 xe:py-2.5 xe:text-sm xe:text-destructive">
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
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? <RiEyeOffLine /> : <RiEyeLine />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {setup && <FieldDescription>At least 8 characters.</FieldDescription>}
          </Field>
          <Button type="submit" className="xe:mt-1 xe:h-10 xe:w-full" disabled={pending}>
            {pending && <Spinner className="xe:size-4" />}
            {pending ? (setup ? "Creating account…" : "Signing in…") : setup ? "Create account" : "Continue"}
          </Button>
        </form>
      </main>

      <footer className="xe:flex xe:h-16 xe:items-center xe:text-xs xe:text-muted-foreground">
        Powered by Xenon{XENON_VERSION === "dev" ? "" : ` · v${XENON_VERSION}`}
      </footer>
    </div>
  );
}

/** Text wordmark; no logo tile. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`xe:inline-flex xe:items-center xe:gap-2 xe:text-[15px] xe:font-semibold xe:tracking-[-0.01em] ${className ?? ""}`}>
      <svg viewBox="0 0 16 16" aria-hidden className="xe:size-4" fill="none">
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="8" cy="8" r="2.5" fill="currentColor" />
      </svg>
      Xenon
    </span>
  );
}
