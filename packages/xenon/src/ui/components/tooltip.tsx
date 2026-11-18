"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { cn } from "../lib/utils"
import { usePortalContainer } from "../lib/portal-container"

function TooltipProvider({
  delay = 0,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  )
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  const container = usePortalContainer();
  if (!container) return null;

  return (
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="xe:isolate xe:z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "xe:z-50 xe:inline-flex xe:w-fit xe:max-w-xs xe:origin-(--transform-origin) xe:items-center xe:gap-1.5 xe:rounded-md xe:bg-foreground xe:px-3 xe:py-1.5 xe:text-xs xe:text-background xe:has-data-[slot=kbd]:pr-1.5 xe:data-[side=bottom]:slide-in-from-top-2 xe:data-[side=inline-end]:slide-in-from-left-2 xe:data-[side=inline-start]:slide-in-from-right-2 xe:data-[side=left]:slide-in-from-right-2 xe:data-[side=right]:slide-in-from-left-2 xe:data-[side=top]:slide-in-from-bottom-2 xe:**:data-[slot=kbd]:relative xe:**:data-[slot=kbd]:isolate xe:**:data-[slot=kbd]:z-50 xe:**:data-[slot=kbd]:rounded-sm xe:data-[state=delayed-open]:animate-in xe:data-[state=delayed-open]:fade-in-0 xe:data-[state=delayed-open]:zoom-in-95 xe:data-open:animate-in xe:data-open:fade-in-0 xe:data-open:zoom-in-95 xe:data-closed:animate-out xe:data-closed:fade-out-0 xe:data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="xe:z-50 xe:size-2.5 xe:translate-y-[calc(-50%-2px)] xe:rotate-45 xe:rounded-[2px] xe:bg-foreground xe:fill-foreground xe:data-[side=bottom]:top-1 xe:data-[side=inline-end]:top-1/2! xe:data-[side=inline-end]:-left-1 xe:data-[side=inline-end]:-translate-y-1/2 xe:data-[side=inline-start]:top-1/2! xe:data-[side=inline-start]:-right-1 xe:data-[side=inline-start]:-translate-y-1/2 xe:data-[side=left]:top-1/2! xe:data-[side=left]:-right-1 xe:data-[side=left]:-translate-y-1/2 xe:data-[side=right]:top-1/2! xe:data-[side=right]:-left-1 xe:data-[side=right]:-translate-y-1/2 xe:data-[side=top]:-bottom-2.5" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
