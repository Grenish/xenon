"use client";

import { useEffect, useRef, useState } from "react";
import { RiPrinterLine } from "@remixicon/react";

export type SlipStage = { stage: string; rows: [string, string][] };

/**
 * Install to publish, as a printed slip. When the section comes into view the slip feeds up out of a
 * printer slot in four steps, one per stage, the way a receipt prints; the torn edge at its foot is
 * where it was torn off at the slot. Every value on it copies itself. Pressing the printer tears the
 * slip off and prints it again. Reduced motion: the slip is simply there.
 */
export function Slip({ stages, version }: { stages: SlipStage[]; version: string }) {
  const root = useRef<HTMLDivElement>(null);
  // "idle": waiting below the slot · "printing": feeding out · "done": torn off and resting · "tearing": leaving
  const [state, setState] = useState<"idle" | "printing" | "done" | "tearing">("idle");

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setState("done");
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setState((s) => (s === "idle" ? "printing" : s));
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const reprint = () => {
    if (state === "printing" || state === "tearing") return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setState("tearing");
  };

  return (
    <div ref={root} className="slip" data-state={state}>
      {/* The paper, clipped at the slot it feeds out of */}
      <div className="slip-mouth">
        <figure
          className="slip-paper slip-cut bg-slip px-7 pt-7 pb-14 text-ink"
          onAnimationEnd={(e) => {
            if (e.target !== e.currentTarget) return;
            if (state === "printing") setState("done");
            else if (state === "tearing") setState("printing");
          }}
        >
          <figcaption className="flex justify-between text-small text-slate">
            <span>Xenon</span>
            <span>{version}</span>
          </figcaption>
          {stages.map((g) => (
            <div key={g.stage}>
              <h3 className="mt-7 font-semibold">{g.stage}</h3>
              <ul className="mt-1.5">
                {g.rows.map(([what, value]) => (
                  <li key={what} className="flex items-baseline gap-2 py-1">
                    <span className="min-w-0">{what}</span>
                    <span className="leader" aria-hidden />
                    <CopyValue value={value} label={what} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="-mx-7 mt-8 flex h-11 items-center justify-between gap-4 bg-ink px-7 font-medium text-slip">
            <span>A CMS in your repo</span>
            <span>3 files, 1 setting</span>
          </div>
        </figure>
      </div>
      {/* The printer it came out of */}
      <button type="button" className="slip-printer" onClick={reprint} aria-label="Print the slip again">
        <RiPrinterLine size={16} aria-hidden />
      </button>
    </div>
  );
}

/** A value on the slip that copies itself, saying so in its own place without changing width. */
function CopyValue({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="slip-value"
      data-done={done || undefined}
      aria-label={`Copy ${label}: ${value}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard unavailable: nothing to confirm */
        }
      }}
    >
      <code className="slip-value__text">{value}</code>
      <span className="slip-value__done" aria-hidden>
        Copied
      </span>
      <span className="sr-only" aria-live="polite">
        {done ? "Copied" : ""}
      </span>
    </button>
  );
}
