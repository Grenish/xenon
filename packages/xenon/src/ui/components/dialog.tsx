"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "../lib/utils"
import { usePortalContainer } from "../lib/portal-container"

import { Button } from "./button"
import { RiCloseLine } from "@remixicon/react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  const container = usePortalContainer();
  if (!container) return null;

  return <DialogPrimitive.Portal container={container} data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "xe:fixed xe:inset-0 xe:isolate xe:z-50 xe:bg-black/10 xe:duration-[160ms] xe:ease-smooth xe:motion-reduce:duration-0 xe:supports-backdrop-filter:backdrop-blur-xs xe:data-open:animate-in xe:data-open:fade-in-0 xe:data-closed:animate-out xe:data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "xe:fixed xe:top-1/2 xe:left-1/2 xe:z-50 xe:grid xe:w-full xe:max-w-[calc(100%-2rem)] xe:-translate-x-1/2 xe:-translate-y-1/2 xe:gap-4 xe:rounded-lg xe:bg-popover xe:p-4 xe:shadow-lg xe:text-sm xe:text-popover-foreground xe:ring-1 xe:ring-foreground/10 xe:duration-[160ms] xe:ease-smooth xe:motion-reduce:duration-0 xe:outline-none xe:sm:max-w-sm xe:data-open:animate-in xe:data-open:fade-in-0 xe:data-open:zoom-in-95 xe:data-closed:animate-out xe:data-closed:fade-out-0 xe:data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="xe:absolute xe:top-2 xe:right-2"
                size="icon-sm"
              />
            }
          >
            <RiCloseLine
            />
            <span className="xe:sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("xe:flex xe:flex-col xe:gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "xe:-mx-4 xe:-mb-4 xe:flex xe:flex-col-reverse xe:gap-2 xe:rounded-b-lg xe:border-t xe:bg-muted/50 xe:p-4 xe:sm:flex-row xe:sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "xe:font-sans xe:text-base xe:leading-none xe:font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "xe:text-sm xe:text-muted-foreground xe:*:[a]:underline xe:*:[a]:underline-offset-3 xe:*:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
