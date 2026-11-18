"use client";

// Adapted from shadcn/ui (MIT), Base UI variant.
import { useMemo } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"

import { Label } from "./label"
import { Separator } from "./separator"

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn(
        "xe:flex xe:flex-col xe:gap-4 xe:has-[>[data-slot=checkbox-group]]:gap-3 xe:has-[>[data-slot=radio-group]]:gap-3",
        className
      )}
      {...props}
    />
  )
}

function FieldLegend({
  className,
  variant = "legend",
  ...props
}: React.ComponentProps<"legend"> & { variant?: "legend" | "label" }) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        "xe:mb-1.5 xe:font-medium xe:data-[variant=label]:text-sm xe:data-[variant=legend]:text-base",
        className
      )}
      {...props}
    />
  )
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn(
        "xe:group/field-group xe:@container/field-group xe:flex xe:w-full xe:flex-col xe:gap-5 xe:data-[slot=checkbox-group]:gap-3 xe:*:data-[slot=field-group]:gap-4",
        className
      )}
      {...props}
    />
  )
}

const fieldVariants = cva(
  "xe:group/field xe:flex xe:w-full xe:gap-2 xe:data-[invalid=true]:text-destructive",
  {
    variants: {
      orientation: {
        vertical: "xe:flex-col xe:*:w-full xe:[&>.sr-only]:w-auto",
        horizontal:
          "xe:flex-row xe:items-center xe:has-[>[data-slot=field-content]]:items-start xe:*:data-[slot=field-label]:flex-auto xe:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
        responsive:
          "xe:flex-col xe:*:w-full xe:@md/field-group:flex-row xe:@md/field-group:items-center xe:@md/field-group:*:w-auto xe:@md/field-group:has-[>[data-slot=field-content]]:items-start xe:@md/field-group:*:data-[slot=field-label]:flex-auto xe:[&>.sr-only]:w-auto xe:@md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
      },
    },
    defaultVariants: {
      orientation: "vertical",
    },
  }
)

function Field({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>) {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  )
}

function FieldContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-content"
      className={cn(
        "xe:group/field-content xe:flex xe:flex-1 xe:flex-col xe:gap-0.5 xe:leading-snug",
        className
      )}
      {...props}
    />
  )
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        "xe:group/field-label xe:peer/field-label xe:flex xe:w-fit xe:gap-2 xe:leading-snug xe:group-data-[disabled=true]/field:opacity-50 xe:has-data-checked:border-primary/30 xe:has-data-checked:bg-primary/5 xe:has-[>[data-slot=field]]:rounded-lg xe:has-[>[data-slot=field]]:border xe:has-[>[data-slot=field]]:not-has-[:disabled,[data-disabled]]:hover:bg-muted/50 xe:has-[>[data-slot=field]]:has-[:focus-visible]:border-ring xe:has-[>[data-slot=field]]:has-[:focus-visible]:ring-[3px] xe:has-[>[data-slot=field]]:has-[:focus-visible]:ring-ring xe:*:data-[slot=field]:p-2.5 xe:dark:has-data-checked:border-primary/20 xe:dark:has-data-checked:bg-primary/10",
        "xe:has-[>[data-slot=field]]:w-full xe:has-[>[data-slot=field]]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function FieldTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-label"
      className={cn(
        "xe:flex xe:w-fit xe:items-center xe:gap-2 xe:text-sm xe:font-medium xe:group-data-[disabled=true]/field:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "xe:text-left xe:text-sm xe:leading-normal xe:font-normal xe:text-muted-foreground xe:group-has-data-horizontal/field:text-balance xe:[[data-variant=legend]+&]:-mt-1.5",
        "xe:last:mt-0 xe:nth-last-2:-mt-1",
        "xe:[&>a]:underline xe:[&>a]:underline-offset-4 xe:[&>a:hover]:text-primary",
        className
      )}
      {...props}
    />
  )
}

function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  children?: React.ReactNode
}) {
  return (
    <div
      data-slot="field-separator"
      data-content={!!children}
      className={cn(
        "xe:relative xe:-my-2 xe:h-5 xe:text-sm xe:group-data-[variant=outline]/field-group:-mb-2",
        className
      )}
      {...props}
    >
      <Separator className="xe:absolute xe:inset-0 xe:top-1/2" />
      {children && (
        <span
          className="xe:relative xe:mx-auto xe:block xe:w-fit xe:bg-background xe:px-2 xe:text-muted-foreground"
          data-slot="field-separator-content"
        >
          {children}
        </span>
      )}
    </div>
  )
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<"div"> & {
  errors?: Array<{ message?: string } | undefined>
}) {
  const content = useMemo(() => {
    if (children) {
      return children
    }

    if (!errors?.length) {
      return null
    }

    const uniqueErrors = [
      ...new Map(errors.map((error) => [error?.message, error])).values(),
    ]

    if (uniqueErrors?.length == 1) {
      return uniqueErrors[0]?.message
    }

    return (
      <ul className="xe:ml-4 xe:flex xe:list-disc xe:flex-col xe:gap-1">
        {uniqueErrors.map(
          (error, index) =>
            error?.message && <li key={index}>{error.message}</li>
        )}
      </ul>
    )
  }, [children, errors])

  if (!content) {
    return null
  }

  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn("xe:text-sm xe:font-normal xe:text-destructive", className)}
      {...props}
    >
      {content}
    </div>
  )
}

export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
}
