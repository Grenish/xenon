"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "../lib/utils"
import { usePortalContainer } from "../lib/portal-container"

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  const container = usePortalContainer();
  if (!container) return null;

  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="xe:isolate xe:z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "xe:z-50 xe:flex xe:w-72 xe:origin-(--transform-origin) xe:flex-col xe:gap-2.5 xe:rounded-lg xe:bg-popover xe:p-2.5 xe:text-sm xe:text-popover-foreground xe:shadow-lg xe:ring-1 xe:ring-foreground/10 xe:outline-hidden xe:duration-[160ms] xe:ease-smooth xe:motion-reduce:duration-0 xe:data-[side=bottom]:slide-in-from-top-2 xe:data-[side=inline-end]:slide-in-from-left-2 xe:data-[side=inline-start]:slide-in-from-right-2 xe:data-[side=left]:slide-in-from-right-2 xe:data-[side=right]:slide-in-from-left-2 xe:data-[side=top]:slide-in-from-bottom-2 xe:data-open:animate-in xe:data-open:fade-in-0 xe:data-open:zoom-in-95 xe:data-closed:animate-out xe:data-closed:fade-out-0 xe:data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("xe:flex xe:flex-col xe:gap-0.5 xe:text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("xe:font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("xe:text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
