"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"

import { Button } from "./button"
import { Input } from "./input"
import { Textarea } from "./textarea"

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "xe:group/input-group xe:relative xe:flex xe:h-9 xe:w-full xe:min-w-0 xe:items-center xe:rounded-lg xe:border xe:border-input xe:transition-colors xe:outline-none xe:in-data-[slot=combobox-content]:focus-within:border-inherit xe:in-data-[slot=combobox-content]:focus-within:ring-0 xe:has-disabled:bg-input/50 xe:has-disabled:opacity-50 xe:has-[[data-slot=input-group-control]:focus-visible]:border-ring xe:has-[[data-slot=input-group-control]:focus-visible]:ring-[3px] xe:has-[[data-slot=input-group-control]:focus-visible]:ring-ring xe:has-[[data-slot][aria-invalid=true]]:border-destructive xe:has-[[data-slot][aria-invalid=true]]:ring-[3px] xe:has-[[data-slot][aria-invalid=true]]:ring-destructive/20 xe:has-[>[data-align=block-end]]:h-auto xe:has-[>[data-align=block-end]]:flex-col xe:has-[>[data-align=block-start]]:h-auto xe:has-[>[data-align=block-start]]:flex-col xe:has-[>textarea]:h-auto xe:dark:bg-input/30 xe:dark:has-disabled:bg-input/80 xe:dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40 xe:has-[>[data-align=block-end]]:[&>input]:pt-3 xe:has-[>[data-align=block-start]]:[&>input]:pb-3 xe:has-[>[data-align=inline-end]]:[&>input]:pr-1.5 xe:has-[>[data-align=inline-start]]:[&>input]:pl-1.5",
        className
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  "xe:flex xe:h-auto xe:cursor-text xe:items-center xe:justify-center xe:gap-2 xe:py-1.5 xe:text-sm xe:font-medium xe:text-muted-foreground xe:select-none xe:group-data-[disabled=true]/input-group:opacity-50 xe:[&>kbd]:rounded-[calc(var(--radius)-5px)] xe:[&>svg:not([class*=size-])]:size-4",
  {
    variants: {
      align: {
        "inline-start":
          "xe:order-first xe:pl-2 xe:has-[>button]:ml-[-0.3rem] xe:has-[>kbd]:ml-[-0.15rem]",
        "inline-end":
          "xe:order-last xe:pr-2 xe:has-[>button]:mr-[-0.3rem] xe:has-[>kbd]:mr-[-0.15rem]",
        "block-start":
          "xe:order-first xe:w-full xe:justify-start xe:px-2.5 xe:pt-2 xe:group-has-[>input]/input-group:pt-2 xe:[.border-b]:pb-2",
        "block-end":
          "xe:order-last xe:w-full xe:justify-start xe:px-2.5 xe:pb-2 xe:group-has-[>input]/input-group:pb-2 xe:[.border-t]:pt-2",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  }
)

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return
        }
        e.currentTarget.parentElement?.querySelector("input")?.focus()
      }}
      {...props}
    />
  )
}

const inputGroupButtonVariants = cva(
  "xe:flex xe:items-center xe:gap-2 xe:text-sm xe:shadow-none",
  {
    variants: {
      size: {
        xs: "xe:h-6 xe:gap-1 xe:rounded-[calc(var(--radius)-3px)] xe:px-1.5 xe:[&>svg:not([class*=size-])]:size-3.5",
        sm: "",
        "icon-xs":
          "xe:size-6 xe:rounded-[calc(var(--radius)-3px)] xe:p-0 xe:has-[>svg]:p-0",
        "icon-sm": "xe:size-8 xe:p-0 xe:has-[>svg]:p-0",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  }
)

function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "type"> &
  VariantProps<typeof inputGroupButtonVariants> & {
    type?: "button" | "submit" | "reset"
  }) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  )
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "xe:flex xe:items-center xe:gap-2 xe:text-sm xe:text-muted-foreground xe:[&_svg]:pointer-events-none xe:[&_svg:not([class*=size-])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        "xe:flex-1 xe:rounded-none xe:border-0 xe:bg-transparent xe:shadow-none xe:ring-0 xe:focus-visible:ring-0 xe:disabled:bg-transparent xe:aria-invalid:ring-0 xe:dark:bg-transparent xe:dark:disabled:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        "xe:flex-1 xe:resize-none xe:rounded-none xe:border-0 xe:bg-transparent xe:py-2 xe:shadow-none xe:ring-0 xe:focus-visible:ring-0 xe:disabled:bg-transparent xe:aria-invalid:ring-0 xe:dark:bg-transparent xe:dark:disabled:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
}
