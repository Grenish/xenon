"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"
import { cn } from "../lib/utils"
import { usePortalContainer } from "../lib/portal-container"

import { Button } from "./button"

function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  )
}

function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
  const container = usePortalContainer();
  if (!container) return null;

  return (
    <AlertDialogPrimitive.Portal container={container} data-slot="alert-dialog-portal" {...props} />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        "xe:fixed xe:inset-0 xe:isolate xe:z-50 xe:bg-black/10 xe:duration-[160ms] xe:ease-smooth xe:motion-reduce:duration-0 xe:supports-backdrop-filter:backdrop-blur-xs xe:data-open:animate-in xe:data-open:fade-in-0 xe:data-closed:animate-out xe:data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  size = "default",
  ...props
}: AlertDialogPrimitive.Popup.Props & {
  size?: "default" | "sm"
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          "xe:group/alert-dialog-content xe:fixed xe:top-1/2 xe:left-1/2 xe:z-50 xe:grid xe:w-full xe:-translate-x-1/2 xe:-translate-y-1/2 xe:gap-4 xe:rounded-lg xe:bg-popover xe:p-4 xe:shadow-lg xe:text-popover-foreground xe:ring-1 xe:ring-foreground/10 xe:duration-[160ms] xe:ease-smooth xe:motion-reduce:duration-0 xe:outline-none xe:data-[size=default]:max-w-xs xe:data-[size=sm]:max-w-xs xe:data-[size=default]:sm:max-w-sm xe:data-open:animate-in xe:data-open:fade-in-0 xe:data-open:zoom-in-95 xe:data-closed:animate-out xe:data-closed:fade-out-0 xe:data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        "xe:grid xe:grid-rows-[auto_1fr] xe:place-items-center xe:gap-1.5 xe:text-center xe:has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] xe:has-data-[slot=alert-dialog-media]:gap-x-4 xe:sm:group-data-[size=default]/alert-dialog-content:place-items-start xe:sm:group-data-[size=default]/alert-dialog-content:text-left xe:sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "xe:-mx-4 xe:-mb-4 xe:flex xe:flex-col-reverse xe:gap-2 xe:rounded-b-lg xe:border-t xe:bg-muted/50 xe:p-4 xe:group-data-[size=sm]/alert-dialog-content:grid xe:group-data-[size=sm]/alert-dialog-content:grid-cols-2 xe:sm:flex-row xe:sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogMedia({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        "xe:mb-2 xe:inline-flex xe:size-10 xe:items-center xe:justify-center xe:rounded-md xe:bg-muted xe:sm:group-data-[size=default]/alert-dialog-content:row-span-2 xe:*:[svg:not([class*=size-])]:size-6",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(
        "xe:font-sans xe:text-base xe:font-medium xe:sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(
        "xe:text-sm xe:text-balance xe:text-muted-foreground xe:md:text-pretty xe:*:[a]:underline xe:*:[a]:underline-offset-3 xe:*:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="alert-dialog-action"
      className={cn(className)}
      {...props}
    />
  )
}

function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}: AlertDialogPrimitive.Close.Props &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      className={cn(className)}
      render={<Button variant={variant} size={size} />}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
