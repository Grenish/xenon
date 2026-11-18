"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "xe:flex xe:w-full xe:min-w-0 xe:flex-1 xe:flex-col xe:items-center xe:justify-center xe:gap-4 xe:rounded-lg xe:border-dashed xe:p-6 xe:text-center xe:text-balance",
        className
      )}
      {...props}
    />
  )
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn("xe:flex xe:max-w-sm xe:flex-col xe:items-center xe:gap-2", className)}
      {...props}
    />
  )
}

const emptyMediaVariants = cva(
  "xe:mb-2 xe:flex xe:shrink-0 xe:items-center xe:justify-center xe:[&_svg]:pointer-events-none xe:[&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "xe:bg-transparent",
        icon: "xe:flex xe:size-8 xe:shrink-0 xe:items-center xe:justify-center xe:rounded-lg xe:bg-muted xe:text-foreground xe:[&_svg:not([class*=size-])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn(
        "xe:font-sans xe:text-sm xe:font-medium xe:tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "xe:text-sm/relaxed xe:text-muted-foreground xe:[&>a]:underline xe:[&>a]:underline-offset-4 xe:[&>a:hover]:text-primary",
        className
      )}
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        "xe:flex xe:w-full xe:max-w-sm xe:min-w-0 xe:flex-col xe:items-center xe:gap-2.5 xe:text-sm xe:text-balance",
        className
      )}
      {...props}
    />
  )
}

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
}
