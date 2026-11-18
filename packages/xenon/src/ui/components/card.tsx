"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import * as React from "react"
import { cn } from "../lib/utils"

function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "xe:group/card xe:flex xe:flex-col xe:gap-(--card-spacing) xe:overflow-hidden xe:rounded-lg xe:bg-card xe:py-(--card-spacing) xe:text-sm xe:text-card-foreground xe:ring-1 xe:ring-foreground/10 xe:[--card-spacing:--spacing(4)] xe:has-data-[slot=card-footer]:pb-0 xe:has-[>img:first-child]:pt-0 xe:data-[size=sm]:[--card-spacing:--spacing(3)] xe:data-[size=sm]:has-data-[slot=card-footer]:pb-0 xe:*:[img:first-child]:rounded-t-xl xe:*:[img:last-child]:rounded-b-xl",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "xe:group/card-header xe:@container/card-header xe:grid xe:auto-rows-min xe:items-start xe:gap-1 xe:rounded-t-xl xe:px-(--card-spacing) xe:has-data-[slot=card-action]:grid-cols-[1fr_auto] xe:has-data-[slot=card-description]:grid-rows-[auto_auto] xe:[.border-b]:pb-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "xe:font-sans xe:text-base xe:leading-snug xe:font-medium xe:group-data-[size=sm]/card:text-sm",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("xe:text-sm xe:text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "xe:col-start-2 xe:row-span-2 xe:row-start-1 xe:self-start xe:justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("xe:px-(--card-spacing)", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "xe:flex xe:items-center xe:rounded-b-lg xe:border-t xe:bg-muted/50 xe:p-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
