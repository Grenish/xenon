"use client";

import { useState } from "react";
import { RiCheckLine, RiFileCopyLine } from "@remixicon/react";

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Copies the install command, and says so on itself. */
export function CopyButton({ text, tone = "accent" }: { text: string; tone?: "accent" | "ink" }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`btn btn--${tone} copy-btn`}
      onClick={async () => {
        if (await copy(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        }
      }}
    >
      {done ? <RiCheckLine size={20} aria-hidden /> : <RiFileCopyLine size={20} aria-hidden />}
      <code>{text}</code>
      <span className="sr-only" aria-live="polite">
        {done ? "Copied to clipboard" : ""}
      </span>
    </button>
  );
}
