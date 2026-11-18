"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import { cn } from "../lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "xe:pointer-events-none xe:inline-flex xe:h-5 xe:w-fit xe:min-w-5 xe:items-center xe:justify-center xe:gap-1 xe:rounded-sm xe:bg-muted xe:px-1 xe:font-sans xe:text-xs xe:font-medium xe:text-muted-foreground xe:select-none xe:in-data-[slot=tooltip-content]:bg-background/20 xe:in-data-[slot=tooltip-content]:text-background xe:dark:in-data-[slot=tooltip-content]:bg-background/10 xe:[&_svg:not([class*=size-])]:size-3",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("xe:inline-flex xe:items-center xe:gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
