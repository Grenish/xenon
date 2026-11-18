"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import * as React from "react"
import { cn } from "../lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "xe:flex xe:field-sizing-content xe:min-h-16 xe:w-full xe:rounded-md xe:border xe:border-input xe:shadow-xs xe:bg-background xe:px-2.5 xe:py-2 xe:text-base xe:transition-colors xe:outline-none xe:placeholder:text-muted-foreground xe:focus-visible:border-ring xe:focus-visible:ring-[3px] xe:focus-visible:ring-ring xe:disabled:cursor-not-allowed xe:disabled:bg-input/50 xe:disabled:opacity-50 xe:aria-invalid:border-destructive xe:aria-invalid:ring-[3px] xe:aria-invalid:ring-destructive/20 xe:md:text-sm xe:dark:bg-input/30 xe:dark:disabled:bg-input/80 xe:dark:aria-invalid:border-destructive/50 xe:dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
