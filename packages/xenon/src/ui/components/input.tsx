"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "../lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "xe:h-9 xe:w-full xe:min-w-0 xe:rounded-md xe:border xe:border-input xe:shadow-xs xe:bg-background xe:px-2.5 xe:py-1 xe:text-base xe:transition-colors xe:outline-none xe:file:inline-flex xe:file:h-6 xe:file:border-0 xe:file:bg-transparent xe:file:text-sm xe:file:font-medium xe:file:text-foreground xe:placeholder:text-muted-foreground xe:focus-visible:border-ring xe:focus-visible:ring-[3px] xe:focus-visible:ring-ring xe:disabled:pointer-events-none xe:disabled:cursor-not-allowed xe:disabled:bg-input/50 xe:disabled:opacity-50 xe:aria-invalid:border-destructive xe:aria-invalid:ring-[3px] xe:aria-invalid:ring-destructive/20 xe:md:text-sm xe:dark:bg-input/30 xe:dark:disabled:bg-input/80 xe:dark:aria-invalid:border-destructive/50 xe:dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
