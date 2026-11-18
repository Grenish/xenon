"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"
import { cn } from "../lib/utils"

function ScrollArea({
  className,
  children,
  ...props
}: ScrollAreaPrimitive.Root.Props) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("xe:relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="xe:size-full xe:rounded-[inherit] xe:transition-[color,box-shadow] xe:outline-none xe:focus-visible:ring-[3px] xe:focus-visible:ring-ring xe:focus-visible:outline-1"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "xe:flex xe:touch-none xe:p-px xe:transition-colors xe:select-none xe:data-horizontal:h-2.5 xe:data-horizontal:flex-col xe:data-horizontal:border-t xe:data-horizontal:border-t-transparent xe:data-vertical:h-full xe:data-vertical:w-2.5 xe:data-vertical:border-l xe:data-vertical:border-l-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="xe:relative xe:flex-1 xe:rounded-full xe:bg-border"
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea, ScrollBar }
