"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"

const badgeVariants = cva(
  "xe:group/badge xe:inline-flex xe:h-5 xe:w-fit xe:shrink-0 xe:items-center xe:justify-center xe:gap-1 xe:overflow-hidden xe:rounded-4xl xe:border xe:border-transparent xe:px-2 xe:py-0.5 xe:text-xs xe:font-medium xe:whitespace-nowrap xe:transition-all xe:focus-visible:border-ring xe:focus-visible:ring-[3px] xe:focus-visible:ring-ring xe:has-data-[icon=inline-end]:pr-1.5 xe:has-data-[icon=inline-start]:pl-1.5 xe:aria-invalid:border-destructive xe:aria-invalid:ring-destructive/20 xe:dark:aria-invalid:ring-destructive/40 xe:[&>svg]:pointer-events-none xe:[&>svg]:size-3!",
  {
    variants: {
      variant: {
        success: "xe:bg-success/10 xe:text-success",
        warning: "xe:bg-warning/15 xe:text-warning-foreground xe:dark:text-warning",
        default: "xe:bg-primary xe:text-primary-foreground xe:[a]:hover:bg-primary/80",
        secondary:
          "xe:bg-secondary xe:text-secondary-foreground xe:[a]:hover:bg-secondary/80",
        destructive:
          "xe:bg-destructive/10 xe:text-destructive xe:focus-visible:ring-destructive/20 xe:dark:bg-destructive/20 xe:dark:focus-visible:ring-destructive/40 xe:[a]:hover:bg-destructive/20",
        outline:
          "xe:border-border xe:text-foreground xe:[a]:hover:bg-muted xe:[a]:hover:text-muted-foreground",
        ghost:
          "xe:hover:bg-muted xe:hover:text-muted-foreground xe:dark:hover:bg-muted/50",
        link: "xe:text-primary xe:underline-offset-4 xe:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
