"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import * as React from "react"
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"
import { cn } from "../lib/utils"

function Avatar({
  className,
  size = "default",
  ...props
}: AvatarPrimitive.Root.Props & {
  size?: "default" | "sm" | "lg"
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        "xe:group/avatar xe:relative xe:flex xe:size-8 xe:shrink-0 xe:rounded-full xe:select-none xe:after:absolute xe:after:inset-0 xe:after:rounded-full xe:after:border xe:after:border-border xe:after:mix-blend-darken xe:data-[size=lg]:size-10 xe:data-[size=sm]:size-6 xe:dark:after:mix-blend-lighten",
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn(
        "xe:aspect-square xe:size-full xe:rounded-full xe:object-cover",
        className
      )}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "xe:flex xe:size-full xe:items-center xe:justify-center xe:rounded-full xe:bg-muted xe:text-sm xe:text-muted-foreground xe:group-data-[size=sm]/avatar:text-xs",
        className
      )}
      {...props}
    />
  )
}

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "xe:absolute xe:right-0 xe:bottom-0 xe:z-10 xe:inline-flex xe:items-center xe:justify-center xe:rounded-full xe:bg-primary xe:text-primary-foreground xe:bg-blend-color xe:ring-2 xe:ring-background xe:select-none",
        "xe:group-data-[size=sm]/avatar:size-2 xe:group-data-[size=sm]/avatar:[&>svg]:hidden",
        "xe:group-data-[size=default]/avatar:size-2.5 xe:group-data-[size=default]/avatar:[&>svg]:size-2",
        "xe:group-data-[size=lg]/avatar:size-3 xe:group-data-[size=lg]/avatar:[&>svg]:size-2",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "xe:group/avatar-group xe:flex xe:*:not-first:-ml-2 xe:*:data-[slot=avatar]:ring-2 xe:*:data-[slot=avatar]:ring-background",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroupCount({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "xe:relative xe:flex xe:size-8 xe:shrink-0 xe:items-center xe:justify-center xe:rounded-full xe:bg-muted xe:text-sm xe:text-muted-foreground xe:ring-2 xe:ring-background xe:group-has-data-[size=lg]/avatar-group:size-10 xe:group-has-data-[size=sm]/avatar-group:size-6 xe:[&>svg]:size-4 xe:group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 xe:group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarBadge,
}
