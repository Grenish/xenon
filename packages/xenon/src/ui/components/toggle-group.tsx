"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import * as React from "react"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"

import { toggleVariants } from "./toggle"

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }
>({
  size: "default",
  variant: "default",
  spacing: 2,
  orientation: "horizontal",
})

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 2,
  orientation = "horizontal",
  children,
  ...props
}: ToggleGroupPrimitive.Props &
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      style={{ "--gap": spacing } as React.CSSProperties}
      className={cn(
        "xe:group/toggle-group xe:flex xe:w-fit xe:flex-row xe:items-center xe:gap-[--spacing(var(--gap))] xe:rounded-lg xe:data-[size=sm]:rounded-[min(var(--radius-md),10px)] xe:data-vertical:flex-col xe:data-vertical:items-stretch",
        className
      )}
      {...props}
    >
      <ToggleGroupContext.Provider
        value={{ variant, size, spacing, orientation }}
      >
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        "xe:shrink-0 xe:group-data-[spacing=0]/toggle-group:rounded-none xe:group-data-[spacing=0]/toggle-group:px-2 xe:focus:z-10 xe:focus-visible:z-10 xe:group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pr-1.5 xe:group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:pl-1.5 xe:group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-l-lg xe:group-data-vertical/toggle-group:data-[spacing=0]:first:rounded-t-lg xe:group-data-horizontal/toggle-group:data-[spacing=0]:last:rounded-r-lg xe:group-data-vertical/toggle-group:data-[spacing=0]:last:rounded-b-lg xe:group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:border-l-0 xe:group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:border-t-0 xe:group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-l xe:group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-t",
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  )
}

export { ToggleGroup, ToggleGroupItem }
