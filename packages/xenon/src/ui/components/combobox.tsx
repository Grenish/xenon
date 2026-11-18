"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { cn } from "../lib/utils"
import { usePortalContainer } from "../lib/portal-container"

import { Button } from "./button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "./input-group"
import { RiArrowDownSLine, RiCloseLine, RiCheckLine } from "@remixicon/react"

const Combobox = ComboboxPrimitive.Root

function ComboboxValue({ ...props }: ComboboxPrimitive.Value.Props) {
  return <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />
}

function ComboboxTrigger({
  className,
  children,
  ...props
}: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn("xe:[&_svg:not([class*=size-])]:size-4", className)}
      {...props}
    >
      {children}
      <RiArrowDownSLine className="xe:pointer-events-none xe:size-4 xe:text-muted-foreground" />
    </ComboboxPrimitive.Trigger>
  )
}

function ComboboxClear({ className, ...props }: ComboboxPrimitive.Clear.Props) {
  return (
    <ComboboxPrimitive.Clear
      data-slot="combobox-clear"
      render={<InputGroupButton variant="ghost" size="icon-xs" />}
      className={cn(className)}
      {...props}
    >
      <RiCloseLine className="xe:pointer-events-none" />
    </ComboboxPrimitive.Clear>
  )
}

function ComboboxInput({
  className,
  children,
  disabled = false,
  showTrigger = true,
  showClear = false,
  ...props
}: ComboboxPrimitive.Input.Props & {
  showTrigger?: boolean
  showClear?: boolean
}) {
  return (
    <InputGroup className={cn("xe:w-auto", className)}>
      <ComboboxPrimitive.Input
        render={<InputGroupInput disabled={disabled} />}
        {...props}
      />
      <InputGroupAddon align="inline-end">
        {showTrigger && (
          <InputGroupButton
            size="icon-xs"
            variant="ghost"
            render={<ComboboxTrigger />}
            data-slot="input-group-button"
            className="xe:group-has-data-[slot=combobox-clear]/input-group:hidden xe:data-pressed:bg-transparent"
            disabled={disabled}
          />
        )}
        {showClear && <ComboboxClear disabled={disabled} />}
      </InputGroupAddon>
      {children}
    </InputGroup>
  )
}

function ComboboxContent({
  className,
  side = "bottom",
  sideOffset = 6,
  align = "start",
  alignOffset = 0,
  anchor,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset" | "anchor"
  >) {
  const container = usePortalContainer();
  if (!container) return null;

  return (
    <ComboboxPrimitive.Portal container={container}>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="xe:isolate xe:z-50"
      >
        {/* min-h-10: near the viewport edge the popup would otherwise shrink to a sliver (max-h = available
            height) and never overflow, so the positioner would never flip it to the other side. */}
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          data-chips={!!anchor}
          className={cn("xe:group/combobox-content xe:relative xe:min-h-10 xe:max-h-(--available-height) xe:w-(--anchor-width) xe:max-w-(--available-width) xe:min-w-[calc(var(--anchor-width)+--spacing(7))] xe:origin-(--transform-origin) xe:overflow-hidden xe:rounded-lg xe:bg-popover xe:text-popover-foreground xe:shadow-lg xe:ring-1 xe:ring-foreground/10 xe:duration-[160ms] xe:ease-smooth xe:motion-reduce:duration-0 xe:data-[chips=true]:min-w-(--anchor-width) xe:data-[side=bottom]:slide-in-from-top-2 xe:data-[side=inline-end]:slide-in-from-left-2 xe:data-[side=inline-start]:slide-in-from-right-2 xe:data-[side=left]:slide-in-from-right-2 xe:data-[side=right]:slide-in-from-left-2 xe:data-[side=top]:slide-in-from-bottom-2 xe:*:data-[slot=input-group]:m-1 xe:*:data-[slot=input-group]:mb-0 xe:*:data-[slot=input-group]:h-8 xe:*:data-[slot=input-group]:border-input/30 xe:*:data-[slot=input-group]:bg-input/30 xe:*:data-[slot=input-group]:shadow-none xe:data-open:animate-in xe:data-open:fade-in-0 xe:data-open:zoom-in-95 xe:data-closed:animate-out xe:data-closed:fade-out-0 xe:data-closed:zoom-out-95", className )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        "xe:no-scrollbar xe:max-h-[min(calc(--spacing(72)---spacing(9)),calc(var(--available-height)---spacing(9)))] xe:scroll-py-1 xe:overflow-y-auto xe:overscroll-contain xe:p-1 xe:data-empty:p-0",
        className
      )}
      {...props}
    />
  )
}

function ComboboxItem({
  className,
  children,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "xe:relative xe:flex xe:w-full xe:cursor-default xe:items-center xe:gap-2 xe:rounded-md xe:py-1 xe:pr-8 xe:pl-1.5 xe:text-sm xe:outline-hidden xe:select-none xe:data-highlighted:bg-accent xe:data-highlighted:text-accent-foreground xe:not-data-[variant=destructive]:data-highlighted:**:text-accent-foreground xe:data-disabled:pointer-events-none xe:data-disabled:opacity-50 xe:[&_svg]:pointer-events-none xe:[&_svg]:shrink-0 xe:[&_svg:not([class*=size-])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator
        render={
          <span className="xe:pointer-events-none xe:absolute xe:right-2 xe:flex xe:size-4 xe:items-center xe:justify-center" />
        }
      >
        <RiCheckLine className="xe:pointer-events-none" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
  return (
    <ComboboxPrimitive.Group
      data-slot="combobox-group"
      className={cn(className)}
      {...props}
    />
  )
}

function ComboboxLabel({
  className,
  ...props
}: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-label"
      className={cn("xe:px-2 xe:py-1.5 xe:text-xs xe:text-muted-foreground", className)}
      {...props}
    />
  )
}

function ComboboxCollection({ ...props }: ComboboxPrimitive.Collection.Props) {
  return (
    <ComboboxPrimitive.Collection data-slot="combobox-collection" {...props} />
  )
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        "xe:hidden xe:w-full xe:justify-center xe:py-2 xe:text-center xe:text-sm xe:text-muted-foreground xe:group-data-empty/combobox-content:flex",
        className
      )}
      {...props}
    />
  )
}

function ComboboxSeparator({
  className,
  ...props
}: ComboboxPrimitive.Separator.Props) {
  return (
    <ComboboxPrimitive.Separator
      data-slot="combobox-separator"
      className={cn("xe:-mx-1 xe:my-1 xe:h-px xe:bg-border", className)}
      {...props}
    />
  )
}

function ComboboxChips({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof ComboboxPrimitive.Chips> &
  ComboboxPrimitive.Chips.Props) {
  return (
    <ComboboxPrimitive.Chips
      data-slot="combobox-chips"
      className={cn(
        "xe:flex xe:min-h-8 xe:flex-wrap xe:items-center xe:gap-1 xe:rounded-lg xe:border xe:border-input xe:bg-transparent xe:bg-clip-padding xe:px-2.5 xe:py-1 xe:text-sm xe:transition-colors xe:focus-within:border-ring xe:focus-within:ring-[3px] xe:focus-within:ring-ring xe:has-aria-invalid:border-destructive xe:has-aria-invalid:ring-[3px] xe:has-aria-invalid:ring-destructive/20 xe:has-data-[slot=combobox-chip]:px-1 xe:dark:bg-input/30 xe:dark:has-aria-invalid:border-destructive/50 xe:dark:has-aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

function ComboboxChip({
  className,
  children,
  showRemove = true,
  ...props
}: ComboboxPrimitive.Chip.Props & {
  showRemove?: boolean
}) {
  return (
    <ComboboxPrimitive.Chip
      data-slot="combobox-chip"
      className={cn(
        "xe:flex xe:h-[calc(--spacing(5.25))] xe:w-fit xe:items-center xe:justify-center xe:gap-1 xe:rounded-sm xe:bg-muted xe:px-1.5 xe:text-xs xe:font-medium xe:whitespace-nowrap xe:text-foreground xe:has-disabled:pointer-events-none xe:has-disabled:cursor-not-allowed xe:has-disabled:opacity-50 xe:has-data-[slot=combobox-chip-remove]:pr-0",
        className
      )}
      {...props}
    >
      {children}
      {showRemove && (
        <ComboboxPrimitive.ChipRemove
          render={<Button variant="ghost" size="icon-xs" />}
          className="xe:-ml-1 xe:opacity-50 xe:hover:opacity-100"
          data-slot="combobox-chip-remove"
        >
          <RiCloseLine className="xe:pointer-events-none" />
        </ComboboxPrimitive.ChipRemove>
      )}
    </ComboboxPrimitive.Chip>
  )
}

function ComboboxChipsInput({
  className,
  ...props
}: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-chip-input"
      className={cn("xe:min-w-16 xe:flex-1 xe:outline-none", className)}
      {...props}
    />
  )
}

function useComboboxAnchor() {
  return React.useRef<HTMLDivElement | null>(null)
}

export {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxGroup,
  ComboboxLabel,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxSeparator,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor,
}
