"use client";

import { useState } from "react";
import { RiCheckLine, RiFileCopyLine } from "@remixicon/react";

/** Copies `text()` and says so on itself for a moment. */
export function CopyButton({ text, className = "" }: { text: () => string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`docs-copy ${className}`}
      aria-label={done ? "Copied" : "Copy code"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text());
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {done ? <RiCheckLine size={16} aria-hidden /> : <RiFileCopyLine size={16} aria-hidden />}
      <span className="sr-only" aria-live="polite">
        {done ? "Copied" : ""}
      </span>
    </button>
  );
}
