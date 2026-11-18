"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "../lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "xe:peer xe:group/switch xe:relative xe:inline-flex xe:shrink-0 xe:items-center xe:rounded-full xe:border xe:border-transparent xe:transition-all xe:outline-none xe:group-has-[:focus-visible]/field-label:border-transparent xe:group-has-[:focus-visible]/field-label:ring-0 xe:after:absolute xe:after:-inset-x-3 xe:after:-inset-y-2 xe:focus-visible:border-ring xe:focus-visible:ring-[3px] xe:focus-visible:ring-ring xe:aria-invalid:border-destructive xe:aria-invalid:ring-[3px] xe:aria-invalid:ring-destructive/20 xe:data-[size=default]:h-[18.4px] xe:data-[size=default]:w-[32px] xe:data-[size=sm]:h-[14px] xe:data-[size=sm]:w-[24px] xe:dark:aria-invalid:border-destructive/50 xe:dark:aria-invalid:ring-destructive/40 xe:data-checked:bg-primary xe:data-unchecked:bg-input xe:dark:data-unchecked:bg-input/80 xe:data-disabled:cursor-not-allowed xe:data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="xe:pointer-events-none xe:block xe:rounded-full xe:bg-background xe:ring-0 xe:transition-transform xe:group-data-[size=default]/switch:size-4 xe:group-data-[size=sm]/switch:size-3 xe:group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] xe:group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] xe:dark:data-checked:bg-primary-foreground xe:group-data-[size=default]/switch:data-unchecked:translate-x-0 xe:group-data-[size=sm]/switch:data-unchecked:translate-x-0 xe:dark:data-unchecked:bg-foreground"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
