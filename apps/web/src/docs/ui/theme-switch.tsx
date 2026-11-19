"use client";

import { useSyncExternalStore } from "react";
import { RiComputerLine, RiMoonLine, RiSunLine } from "@remixicon/react";

export type ThemePref = "system" | "light" | "dark";
const KEY = "docs:theme";
const EVENT = "docs:theme";

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function subscribe(cb: () => void) {
  addEventListener(EVENT, cb);
  addEventListener("storage", cb);
  return () => {
    removeEventListener(EVENT, cb);
    removeEventListener("storage", cb);
  };
}

/** Applies a choice to the docs root: an explicit light or dark, or none (the system decides, in CSS). */
function apply(pref: ThemePref) {
  const root = document.querySelector<HTMLElement>(".docs");
  if (!root) return;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
}

/**
 * Runs before the docs paint (inlined in the layout), so a saved choice never flashes the other theme first.
 * Keep in sync with `read` and `apply` above.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(KEY)});if(t==="light"||t==="dark")document.currentScript.parentElement.dataset.theme=t}catch(e){}`;

const OPTIONS: { value: ThemePref; label: string; Icon: typeof RiSunLine }[] = [
  { value: "system", label: "System theme", Icon: RiComputerLine },
  { value: "light", label: "Light theme", Icon: RiSunLine },
  { value: "dark", label: "Dark theme", Icon: RiMoonLine },
];

/** System / light / dark, remembered across visits. */
export function ThemeSwitch({ className = "" }: { className?: string }) {
  const pref = useSyncExternalStore(subscribe, read, () => "system" as ThemePref);
  const set = (v: ThemePref) => {
    try {
      if (v === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, v);
    } catch {
      /* not remembered, but still applied */
    }
    apply(v);
    dispatchEvent(new Event(EVENT));
  };
  return (
    <div role="radiogroup" aria-label="Theme" className={`flex items-center gap-0.5 rounded-[4px] border border-(--d-line) p-0.5 ${className}`}>
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          aria-label={label}
          title={label}
          onClick={() => set(value)}
          className={`grid size-7 cursor-pointer place-items-center rounded-[3px] transition-colors ${
            pref === value ? "bg-(--d-hover) text-paper" : "text-mist hover:text-paper"
          }`}
        >
          <Icon size={15} aria-hidden />
        </button>
      ))}
    </div>
  );
}
