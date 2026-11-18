"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { cn } from "../lib/utils"
import { RiCheckLine } from "@remixicon/react"

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "xe:peer xe:relative xe:flex xe:size-4 xe:shrink-0 xe:items-center xe:justify-center xe:rounded-[4px] xe:border xe:border-input xe:transition-colors xe:outline-none xe:group-has-disabled/field:opacity-50 xe:group-has-[:focus-visible]/field-label:ring-0 xe:group-has-[:focus-visible]/field-label:not-data-checked:border-input xe:after:absolute xe:after:-inset-x-3 xe:after:-inset-y-2 xe:focus-visible:border-ring xe:focus-visible:ring-[3px] xe:focus-visible:ring-ring xe:disabled:cursor-not-allowed xe:disabled:opacity-50 xe:aria-invalid:border-destructive xe:aria-invalid:ring-[3px] xe:aria-invalid:ring-destructive/20 xe:aria-invalid:aria-checked:border-primary xe:dark:bg-input/30 xe:dark:aria-invalid:border-destructive/50 xe:dark:aria-invalid:ring-destructive/40 xe:data-checked:border-primary xe:data-checked:bg-primary xe:data-checked:text-primary-foreground xe:group-has-[:focus-visible]/field-label:data-checked:border-primary xe:dark:data-checked:bg-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="xe:grid xe:place-content-center xe:text-current xe:transition-none xe:[&>svg]:size-3.5"
      >
        <RiCheckLine
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
