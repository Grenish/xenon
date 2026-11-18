"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"

const alertVariants = cva(
  "xe:group/alert xe:relative xe:grid xe:w-full xe:gap-0.5 xe:rounded-lg xe:border xe:px-2.5 xe:py-2 xe:text-left xe:text-sm xe:has-data-[slot=alert-action]:relative xe:has-data-[slot=alert-action]:pr-18 xe:has-[>svg]:grid-cols-[auto_1fr] xe:has-[>svg]:gap-x-2 xe:*:[svg]:row-span-2 xe:*:[svg]:translate-y-0.5 xe:*:[svg]:text-current xe:*:[svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        default: "xe:bg-card xe:text-card-foreground",
        destructive:
          "xe:bg-card xe:text-destructive xe:*:data-[slot=alert-description]:text-destructive/90 xe:*:[svg]:text-current",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "xe:font-medium xe:group-has-[>svg]/alert:col-start-2 xe:[&_a]:underline xe:[&_a]:underline-offset-3 xe:[&_a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "xe:text-sm xe:text-balance xe:text-muted-foreground xe:md:text-pretty xe:[&_a]:underline xe:[&_a]:underline-offset-3 xe:[&_a]:hover:text-foreground xe:[&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("xe:absolute xe:top-2 xe:right-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
