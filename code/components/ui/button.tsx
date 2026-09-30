import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Adapted from the shadcn radix-nova button to docs/design-system.md:
// Mantis fill with Ink text, 44 px targets, a 2 px Ink focus outline, no dark mode.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding font-semibold whitespace-nowrap no-underline transition-colors select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // The one "next step" per view (design-system.md §1, rule 1).
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        // Secondary actions: Milky with a 1.5 px Ink border.
        outline:
          "border-[1.5px] border-foreground bg-background text-foreground hover:bg-muted aria-expanded:bg-muted",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_srgb,var(--secondary),var(--foreground)_6%)] aria-expanded:bg-secondary",
        ghost: "text-foreground hover:bg-muted aria-expanded:bg-muted",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
        // Mantis Deep, always underlined: colour alone is under 3:1 against Ink text.
        link: "h-auto px-0 text-link underline underline-offset-4",
      },
      size: {
        default:
          "h-11 gap-2 px-5 text-base has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        lg: "h-12 gap-2 px-6 text-base has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5",
        icon: "size-11",
        "icon-lg": "size-12",
        // Below 44 px: dense admin tables on desktop only, never public pages.
        sm: "h-9 gap-1.5 px-3 text-sm has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-7 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
