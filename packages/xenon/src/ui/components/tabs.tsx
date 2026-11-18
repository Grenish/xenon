"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "xe:group/tabs xe:flex xe:gap-2 xe:data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "xe:group/tabs-list xe:inline-flex xe:w-fit xe:items-center xe:justify-center xe:rounded-lg xe:p-[3px] xe:text-muted-foreground xe:group-data-horizontal/tabs:h-8 xe:group-data-vertical/tabs:h-fit xe:group-data-vertical/tabs:flex-col xe:data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "xe:bg-muted",
        line: "xe:gap-1 xe:bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "xe:relative xe:inline-flex xe:h-[calc(100%-1px)] xe:flex-1 xe:items-center xe:justify-center xe:gap-1.5 xe:rounded-md xe:border xe:border-transparent xe:px-1.5 xe:py-0.5 xe:text-sm xe:font-medium xe:whitespace-nowrap xe:text-foreground/60 xe:transition-all xe:group-data-vertical/tabs:w-full xe:group-data-vertical/tabs:justify-start xe:hover:text-foreground xe:focus-visible:border-ring xe:focus-visible:ring-[3px] xe:focus-visible:ring-ring xe:focus-visible:outline-1 xe:focus-visible:outline-ring xe:disabled:pointer-events-none xe:disabled:opacity-50 xe:has-data-[icon=inline-end]:pr-1 xe:has-data-[icon=inline-start]:pl-1 xe:aria-disabled:pointer-events-none xe:aria-disabled:opacity-50 xe:dark:text-muted-foreground xe:dark:hover:text-foreground xe:group-data-[variant=default]/tabs-list:data-active:shadow-sm xe:group-data-[variant=line]/tabs-list:data-active:shadow-none xe:[&_svg]:pointer-events-none xe:[&_svg]:shrink-0 xe:[&_svg:not([class*=size-])]:size-4",
        "xe:group-data-[variant=line]/tabs-list:bg-transparent xe:group-data-[variant=line]/tabs-list:data-active:bg-transparent xe:dark:group-data-[variant=line]/tabs-list:data-active:border-transparent xe:dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "xe:data-active:bg-background xe:data-active:text-foreground xe:dark:data-active:border-input xe:dark:data-active:bg-input/30 xe:dark:data-active:text-foreground",
        "xe:after:absolute xe:after:bg-foreground xe:after:opacity-0 xe:after:transition-opacity xe:group-data-horizontal/tabs:after:inset-x-0 xe:group-data-horizontal/tabs:after:bottom-[-5px] xe:group-data-horizontal/tabs:after:h-0.5 xe:group-data-vertical/tabs:after:inset-y-0 xe:group-data-vertical/tabs:after:-right-1 xe:group-data-vertical/tabs:after:w-0.5 xe:group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("xe:flex-1 xe:text-sm xe:outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
