"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { cn } from "../lib/utils"
import { usePortalContainer } from "../lib/portal-container"
import { RiArrowDownSLine, RiCheckLine, RiArrowUpSLine } from "@remixicon/react"

const Select = SelectPrimitive.Root

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("xe:scroll-my-1 xe:p-1", className)}
      {...props}
    />
  )
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("xe:flex xe:flex-1 xe:text-left", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "xe:flex xe:w-fit xe:items-center xe:justify-between xe:gap-1.5 xe:rounded-md xe:border xe:border-input xe:bg-transparent xe:py-2 xe:pr-2 xe:pl-2.5 xe:text-sm xe:whitespace-nowrap xe:transition-colors xe:outline-none xe:select-none xe:focus-visible:border-ring xe:focus-visible:ring-[3px] xe:focus-visible:ring-ring xe:disabled:cursor-not-allowed xe:disabled:opacity-50 xe:aria-invalid:border-destructive xe:aria-invalid:ring-[3px] xe:aria-invalid:ring-destructive/20 xe:data-placeholder:text-muted-foreground xe:data-[size=default]:h-9 xe:data-[size=sm]:h-7 xe:data-[size=sm]:rounded-[min(var(--radius-md),10px)] xe:*:data-[slot=select-value]:line-clamp-1 xe:*:data-[slot=select-value]:flex xe:*:data-[slot=select-value]:items-center xe:*:data-[slot=select-value]:gap-1.5 xe:dark:bg-input/30 xe:dark:hover:bg-input/50 xe:dark:aria-invalid:border-destructive/50 xe:dark:aria-invalid:ring-destructive/40 xe:[&_svg]:pointer-events-none xe:[&_svg]:shrink-0 xe:[&_svg:not([class*=size-])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <RiArrowDownSLine className="xe:pointer-events-none xe:size-4 xe:text-muted-foreground" />
        }
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  const container = usePortalContainer();
  if (!container) return null;

  return (
    <SelectPrimitive.Portal container={container}>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="xe:isolate xe:z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          className={cn("  xe:relative xe:isolate xe:z-50 xe:max-h-(--available-height) xe:w-(--anchor-width) xe:min-w-36 xe:origin-(--transform-origin) xe:overflow-x-hidden xe:overflow-y-auto xe:rounded-lg xe:bg-popover xe:text-popover-foreground xe:shadow-lg xe:ring-1 xe:ring-foreground/10 xe:duration-[160ms] xe:ease-smooth xe:motion-reduce:duration-0 xe:data-[align-trigger=true]:animate-none xe:data-[side=bottom]:slide-in-from-top-2 xe:data-[side=inline-end]:slide-in-from-left-2 xe:data-[side=inline-start]:slide-in-from-right-2 xe:data-[side=left]:slide-in-from-right-2 xe:data-[side=right]:slide-in-from-left-2 xe:data-[side=top]:slide-in-from-bottom-2 xe:data-open:animate-in xe:data-open:fade-in-0 xe:data-open:zoom-in-95 xe:data-closed:animate-out xe:data-closed:fade-out-0 xe:data-closed:zoom-out-95", className )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("xe:px-1.5 xe:py-1 xe:text-xs xe:text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "xe:relative xe:flex xe:w-full xe:cursor-default xe:items-center xe:gap-1.5 xe:rounded-md xe:py-1 xe:pr-8 xe:pl-1.5 xe:text-sm xe:outline-hidden xe:select-none xe:focus:bg-accent xe:focus:text-accent-foreground xe:not-data-[variant=destructive]:focus:**:text-accent-foreground xe:data-disabled:pointer-events-none xe:data-disabled:opacity-50 xe:[&_svg]:pointer-events-none xe:[&_svg]:shrink-0 xe:[&_svg:not([class*=size-])]:size-4 xe:*:[span]:last:flex xe:*:[span]:last:items-center xe:*:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="xe:flex xe:flex-1 xe:shrink-0 xe:gap-2 xe:whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="xe:pointer-events-none xe:absolute xe:right-2 xe:flex xe:size-4 xe:items-center xe:justify-center" />
        }
      >
        <RiCheckLine className="xe:pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("xe:pointer-events-none xe:-mx-1 xe:my-1 xe:h-px xe:bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "xe:top-0 xe:z-10 xe:flex xe:w-full xe:cursor-default xe:items-center xe:justify-center xe:bg-popover xe:py-1 xe:[&_svg:not([class*=size-])]:size-4",
        className
      )}
      {...props}
    >
      <RiArrowUpSLine
      />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "xe:bottom-0 xe:z-10 xe:flex xe:w-full xe:cursor-default xe:items-center xe:justify-center xe:bg-popover xe:py-1 xe:[&_svg:not([class*=size-])]:size-4",
        className
      )}
      {...props}
    >
      <RiArrowDownSLine
      />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
