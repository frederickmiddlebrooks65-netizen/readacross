import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const labelVariants = cva(
  "text-sm font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70 border-0"
)

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
    VariantProps<typeof labelVariants>
>(({ className, style, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(labelVariants(), className)}
    style={{
      textDecoration: 'none',
      border: 'none',
      borderTop: 'none',
      borderBottom: 'none',
      outline: 'none',
      boxShadow: 'none',
      ...style
    }}
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
