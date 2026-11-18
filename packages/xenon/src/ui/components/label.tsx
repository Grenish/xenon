"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import * as React from "react"
import { cn } from "../lib/utils"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "xe:flex xe:items-center xe:gap-2 xe:text-sm xe:leading-none xe:font-medium xe:select-none xe:group-data-[disabled=true]:pointer-events-none xe:group-data-[disabled=true]:opacity-50 xe:peer-disabled:cursor-not-allowed xe:peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
