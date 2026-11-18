"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"
import { cn } from "../lib/utils"
import { usePortalContainer } from "../lib/portal-container"

import { Button } from "./button"
import { RiCloseLine } from "@remixicon/react"

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  const container = usePortalContainer();
  if (!container) return null;

  return <SheetPrimitive.Portal container={container} data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "xe:fixed xe:inset-0 xe:z-50 xe:bg-black/10 xe:transition-opacity xe:duration-150 xe:data-ending-style:opacity-0 xe:data-starting-style:opacity-0 xe:supports-backdrop-filter:backdrop-blur-xs",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "xe:fixed xe:z-50 xe:flex xe:flex-col xe:gap-4 xe:bg-popover xe:bg-clip-padding xe:text-sm xe:text-popover-foreground xe:shadow-lg xe:transition xe:duration-200 xe:ease-in-out xe:data-ending-style:opacity-0 xe:data-starting-style:opacity-0 xe:data-[side=bottom]:inset-x-0 xe:data-[side=bottom]:bottom-0 xe:data-[side=bottom]:h-auto xe:data-[side=bottom]:border-t xe:data-[side=bottom]:data-ending-style:translate-y-[2.5rem] xe:data-[side=bottom]:data-starting-style:translate-y-[2.5rem] xe:data-[side=left]:inset-y-0 xe:data-[side=left]:left-0 xe:data-[side=left]:h-full xe:data-[side=left]:w-3/4 xe:data-[side=left]:border-r xe:data-[side=left]:data-ending-style:translate-x-[-2.5rem] xe:data-[side=left]:data-starting-style:translate-x-[-2.5rem] xe:data-[side=right]:inset-y-0 xe:data-[side=right]:right-0 xe:data-[side=right]:h-full xe:data-[side=right]:w-3/4 xe:data-[side=right]:border-l xe:data-[side=right]:data-ending-style:translate-x-[2.5rem] xe:data-[side=right]:data-starting-style:translate-x-[2.5rem] xe:data-[side=top]:inset-x-0 xe:data-[side=top]:top-0 xe:data-[side=top]:h-auto xe:data-[side=top]:border-b xe:data-[side=top]:data-ending-style:translate-y-[-2.5rem] xe:data-[side=top]:data-starting-style:translate-y-[-2.5rem] xe:data-[side=left]:sm:max-w-sm xe:data-[side=right]:sm:max-w-sm",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                className="xe:absolute xe:top-3 xe:right-3"
                size="icon-sm"
              />
            }
          >
            <RiCloseLine
            />
            <span className="xe:sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("xe:flex xe:flex-col xe:gap-0.5 xe:p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("xe:mt-auto xe:flex xe:flex-col xe:gap-2 xe:p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "xe:font-sans xe:text-base xe:font-medium xe:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("xe:text-sm xe:text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
