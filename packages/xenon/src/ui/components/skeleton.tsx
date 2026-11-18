"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import { cn } from "../lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("xe:animate-pulse xe:rounded-md xe:bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
