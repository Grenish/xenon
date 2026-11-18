"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import { cn } from "../lib/utils"
import { RiLoaderLine } from "@remixicon/react"

function Spinner({ className, ...props }: React.ComponentProps<typeof RiLoaderLine>) {
  return (
    <RiLoaderLine data-slot="spinner" role="status" aria-label="Loading" className={cn("xe:size-4 xe:animate-spin", className)} {...props} />
  )
}

export { Spinner }
