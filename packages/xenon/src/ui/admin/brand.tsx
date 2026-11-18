"use client";
import { cn } from "../lib/utils";

/**
 * Xenon's mark is its periodic-table tile: element 54, symbol Xe. Small sizes show the symbol only;
 * the large tile (sign-in) carries the atomic number and weight like a real table cell.
 */
export function ElementMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "xe:inline-grid xe:size-6 xe:shrink-0 xe:place-items-center xe:rounded-[5px] xe:bg-brand xe:text-[11.5px] xe:font-semibold xe:leading-none xe:tracking-[-0.01em] xe:text-brand-foreground",
        className,
      )}
    >
      Xe
    </span>
  );
}

export function ElementTile({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "xe:flex xe:aspect-square xe:w-36 xe:flex-col xe:justify-between xe:rounded-[10px] xe:bg-brand xe:p-3.5 xe:text-brand-foreground",
        className,
      )}
    >
      <div className="xe:flex xe:items-start xe:justify-between xe:text-[13px] xe:font-medium xe:tabular-nums xe:leading-none">
        <span>54</span>
        <span className="xe:opacity-80">131.29</span>
      </div>
      <div className="xe:flex xe:flex-col xe:gap-1">
        <span className="xe:text-[52px] xe:font-semibold xe:leading-[0.9] xe:tracking-[-0.03em]">Xe</span>
        <span className="xe:text-[13px] xe:font-medium xe:leading-none xe:opacity-90">Xenon</span>
      </div>
    </div>
  );
}

/** Mark + product name. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("xe:inline-flex xe:items-center xe:gap-2.5 xe:text-[15px] xe:font-semibold xe:tracking-[-0.01em]", className)}>
      <ElementMark />
      Xenon
    </span>
  );
}
