"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"

const toggleVariants = cva(
  "xe:group/toggle xe:inline-flex xe:items-center xe:justify-center xe:gap-1 xe:rounded-lg xe:text-sm xe:font-medium xe:whitespace-nowrap xe:transition-all xe:outline-none xe:hover:bg-muted xe:hover:text-foreground xe:focus-visible:border-ring xe:focus-visible:ring-[3px] xe:focus-visible:ring-ring xe:disabled:pointer-events-none xe:disabled:opacity-50 xe:aria-invalid:border-destructive xe:aria-invalid:ring-destructive/20 xe:aria-pressed:bg-muted xe:data-[state=on]:bg-muted xe:dark:aria-invalid:ring-destructive/40 xe:[&_svg]:pointer-events-none xe:[&_svg]:shrink-0 xe:[&_svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        default: "xe:bg-transparent",
        outline: "xe:border xe:border-input xe:bg-transparent xe:hover:bg-muted",
      },
      size: {
        default:
          "xe:h-8 xe:min-w-8 xe:px-2.5 xe:has-data-[icon=inline-end]:pr-2 xe:has-data-[icon=inline-start]:pl-2",
        sm: "xe:h-7 xe:min-w-7 xe:rounded-[min(var(--radius-md),12px)] xe:px-2.5 xe:text-[0.8rem] xe:has-data-[icon=inline-end]:pr-1.5 xe:has-data-[icon=inline-start]:pl-1.5 xe:[&_svg:not([class*=size-])]:size-3.5",
        lg: "xe:h-9 xe:min-w-9 xe:px-2.5 xe:has-data-[icon=inline-end]:pr-2 xe:has-data-[icon=inline-start]:pl-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
