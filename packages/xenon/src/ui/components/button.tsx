"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"

const buttonVariants = cva(
  "xe:group/button xe:inline-flex xe:shrink-0 xe:items-center xe:justify-center xe:rounded-md xe:border xe:border-transparent xe:bg-clip-padding xe:text-sm xe:font-medium xe:whitespace-nowrap xe:transition-all xe:outline-none xe:select-none xe:focus-visible:border-ring xe:focus-visible:ring-[3px] xe:focus-visible:ring-ring xe:active:not-aria-[haspopup]:translate-y-px xe:disabled:pointer-events-none xe:disabled:opacity-50 xe:aria-invalid:border-destructive xe:aria-invalid:ring-[3px] xe:aria-invalid:ring-destructive/20 xe:dark:aria-invalid:border-destructive/50 xe:dark:aria-invalid:ring-destructive/40 xe:[&_svg]:pointer-events-none xe:[&_svg]:shrink-0 xe:[&_svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        default: "xe:bg-primary xe:text-primary-foreground xe:hover:bg-primary/85",
        outline:
          "xe:border-border xe:bg-background xe:hover:bg-muted xe:hover:text-foreground xe:aria-expanded:bg-muted xe:aria-expanded:text-foreground xe:dark:border-input xe:dark:bg-input/30 xe:dark:hover:bg-input/50",
        secondary:
          "xe:bg-secondary xe:text-secondary-foreground xe:hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] xe:aria-expanded:bg-secondary xe:aria-expanded:text-secondary-foreground",
        ghost:
          "xe:hover:bg-muted xe:hover:text-foreground xe:aria-expanded:bg-muted xe:aria-expanded:text-foreground xe:dark:hover:bg-muted/50",
        destructive:
          "xe:bg-destructive/10 xe:text-destructive xe:hover:bg-destructive/20 xe:focus-visible:border-destructive/40 xe:focus-visible:ring-destructive/20 xe:dark:bg-destructive/20 xe:dark:hover:bg-destructive/30 xe:dark:focus-visible:ring-destructive/40",
        link: "xe:text-primary xe:underline-offset-4 xe:hover:underline",
      },
      size: {
        default:
          "xe:h-8 xe:gap-1.5 xe:px-3 xe:has-data-[icon=inline-end]:pr-2 xe:has-data-[icon=inline-start]:pl-2.5",
        xs: "xe:h-6 xe:gap-1 xe:rounded-[min(var(--radius-md),10px)] xe:px-2 xe:text-xs xe:in-data-[slot=button-group]:rounded-lg xe:has-data-[icon=inline-end]:pr-1.5 xe:has-data-[icon=inline-start]:pl-1.5 xe:[&_svg:not([class*=size-])]:size-3",
        sm: "xe:h-7 xe:gap-1 xe:rounded-[min(var(--radius-md),12px)] xe:px-2.5 xe:text-[0.8rem] xe:in-data-[slot=button-group]:rounded-lg xe:has-data-[icon=inline-end]:pr-1.5 xe:has-data-[icon=inline-start]:pl-1.5 xe:[&_svg:not([class*=size-])]:size-3.5",
        lg: "xe:h-9 xe:gap-1.5 xe:px-2.5 xe:has-data-[icon=inline-end]:pr-2 xe:has-data-[icon=inline-start]:pl-2",
        icon: "xe:size-8",
        "icon-xs":
          "xe:size-6 xe:rounded-[min(var(--radius-md),10px)] xe:in-data-[slot=button-group]:rounded-lg xe:[&_svg:not([class*=size-])]:size-3",
        "icon-sm":
          "xe:size-7 xe:rounded-[min(var(--radius-md),12px)] xe:in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "xe:size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
