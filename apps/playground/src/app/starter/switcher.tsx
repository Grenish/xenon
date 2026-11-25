"use client";

/** Preview-only: floating buttons to switch design versions and simulated data states. */
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { STATES, STATE_COOKIE, VARIANTS, VARIANT_COOKIE, type PreviewState, type Variant } from "./preview-shared";

export function Switcher({ variant, state }: { variant: Variant; state: PreviewState }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const set = (name: string, value: string) => {
    document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  };
  return (
    <div className="starter-switcher" role="toolbar" aria-label="Starter preview" data-pending={pending || undefined}>
      <div className="starter-switcher__group" role="group" aria-label="Design">
        {VARIANTS.map((v, i) => (
          <button key={v.id} type="button" aria-pressed={variant === v.id} onClick={() => set(VARIANT_COOKIE, v.id)}
            aria-label={`Version ${String.fromCharCode(65 + i)}: ${v.label}`} title={`Version ${String.fromCharCode(65 + i)}: ${v.label}`}>
            <span aria-hidden="true">{String.fromCharCode(65 + i)}</span>{variant === v.id ? ` ${v.label}` : null}
          </button>
        ))}
      </div>
      <div className="starter-switcher__group" role="group" aria-label="Data">
        {STATES.map((s) => (
          <button key={s.id} type="button" aria-pressed={state === s.id} onClick={() => set(STATE_COOKIE, s.id)} title={s.hint}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
