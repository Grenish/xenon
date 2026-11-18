"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { cn } from "../lib/utils"
import { usePortalContainer } from "../lib/portal-container"
import { RiArrowRightSLine, RiCheckLine } from "@remixicon/react"

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  const container = usePortalContainer();
  if (!container) return null;

  return <MenuPrimitive.Portal container={container} data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  const container = usePortalContainer();
  if (!container) return null;

  return (
    <MenuPrimitive.Portal container={container}>
      <MenuPrimitive.Positioner
        className="xe:isolate xe:z-50 xe:outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn("  xe:z-50 xe:max-h-(--available-height) xe:w-(--anchor-width) xe:min-w-32 xe:origin-(--transform-origin) xe:overflow-x-hidden xe:overflow-y-auto xe:rounded-lg xe:bg-popover xe:p-1 xe:text-popover-foreground xe:shadow-lg xe:ring-1 xe:ring-foreground/10 xe:duration-[160ms] xe:ease-smooth xe:motion-reduce:duration-0 xe:outline-none xe:data-[side=bottom]:slide-in-from-top-2 xe:data-[side=inline-end]:slide-in-from-left-2 xe:data-[side=inline-start]:slide-in-from-right-2 xe:data-[side=left]:slide-in-from-right-2 xe:data-[side=right]:slide-in-from-left-2 xe:data-[side=top]:slide-in-from-bottom-2 xe:data-open:animate-in xe:data-open:fade-in-0 xe:data-open:zoom-in-95 xe:data-closed:animate-out xe:data-closed:overflow-hidden xe:data-closed:fade-out-0 xe:data-closed:zoom-out-95", className )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "xe:px-1.5 xe:py-1 xe:text-xs xe:font-medium xe:text-muted-foreground xe:data-inset:pl-7",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "xe:group/dropdown-menu-item xe:relative xe:flex xe:cursor-default xe:items-center xe:gap-1.5 xe:rounded-md xe:px-1.5 xe:py-1 xe:text-sm xe:outline-hidden xe:select-none xe:focus:bg-accent xe:focus:text-accent-foreground xe:not-data-[variant=destructive]:focus:**:text-accent-foreground xe:data-inset:pl-7 xe:data-[variant=destructive]:text-destructive xe:data-[variant=destructive]:focus:bg-destructive/10 xe:data-[variant=destructive]:focus:text-destructive xe:dark:data-[variant=destructive]:focus:bg-destructive/20 xe:data-disabled:pointer-events-none xe:data-disabled:opacity-50 xe:[&_svg]:pointer-events-none xe:[&_svg]:shrink-0 xe:[&_svg:not([class*=size-])]:size-4 xe:data-[variant=destructive]:*:[svg]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "xe:flex xe:cursor-default xe:items-center xe:gap-1.5 xe:rounded-md xe:px-1.5 xe:py-1 xe:text-sm xe:outline-hidden xe:select-none xe:focus:bg-accent xe:focus:text-accent-foreground xe:not-data-[variant=destructive]:focus:**:text-accent-foreground xe:data-inset:pl-7 xe:data-popup-open:bg-accent xe:data-popup-open:text-accent-foreground xe:data-open:bg-accent xe:data-open:text-accent-foreground xe:[&_svg]:pointer-events-none xe:[&_svg]:shrink-0 xe:[&_svg:not([class*=size-])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <RiArrowRightSLine className="xe:ml-auto" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  align = "start",
  alignOffset = -3,
  side = "right",
  sideOffset = 0,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      className={cn("  xe:w-auto xe:min-w-[96px] xe:rounded-lg xe:bg-popover xe:p-1 xe:text-popover-foreground xe:shadow-lg xe:ring-1 xe:ring-foreground/10 xe:duration-[160ms] xe:ease-smooth xe:motion-reduce:duration-0 xe:data-[side=bottom]:slide-in-from-top-2 xe:data-[side=left]:slide-in-from-right-2 xe:data-[side=right]:slide-in-from-left-2 xe:data-[side=top]:slide-in-from-bottom-2 xe:data-open:animate-in xe:data-open:fade-in-0 xe:data-open:zoom-in-95 xe:data-closed:animate-out xe:data-closed:fade-out-0 xe:data-closed:zoom-out-95", className )}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "xe:relative xe:flex xe:cursor-default xe:items-center xe:gap-1.5 xe:rounded-md xe:py-1 xe:pr-8 xe:pl-1.5 xe:text-sm xe:outline-hidden xe:select-none xe:focus:bg-accent xe:focus:text-accent-foreground xe:focus:**:text-accent-foreground xe:data-inset:pl-7 xe:data-disabled:pointer-events-none xe:data-disabled:opacity-50 xe:[&_svg]:pointer-events-none xe:[&_svg]:shrink-0 xe:[&_svg:not([class*=size-])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span
        className="xe:pointer-events-none xe:absolute xe:right-2 xe:flex xe:items-center xe:justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <MenuPrimitive.CheckboxItemIndicator>
          <RiCheckLine
          />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return (
    <MenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: MenuPrimitive.RadioItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        "xe:relative xe:flex xe:cursor-default xe:items-center xe:gap-1.5 xe:rounded-md xe:py-1 xe:pr-8 xe:pl-1.5 xe:text-sm xe:outline-hidden xe:select-none xe:focus:bg-accent xe:focus:text-accent-foreground xe:focus:**:text-accent-foreground xe:data-inset:pl-7 xe:data-disabled:pointer-events-none xe:data-disabled:opacity-50 xe:[&_svg]:pointer-events-none xe:[&_svg]:shrink-0 xe:[&_svg:not([class*=size-])]:size-4",
        className
      )}
      {...props}
    >
      <span
        className="xe:pointer-events-none xe:absolute xe:right-2 xe:flex xe:items-center xe:justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <MenuPrimitive.RadioItemIndicator>
          <RiCheckLine
          />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("xe:-mx-1 xe:my-1 xe:h-px xe:bg-border", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "xe:ml-auto xe:text-xs xe:tracking-widest xe:text-muted-foreground xe:group-focus/dropdown-menu-item:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
