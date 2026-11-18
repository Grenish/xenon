"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"
import { cn } from "../lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "xe:shrink-0 xe:bg-border xe:data-horizontal:h-px xe:data-horizontal:w-full xe:data-vertical:w-px xe:data-vertical:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
