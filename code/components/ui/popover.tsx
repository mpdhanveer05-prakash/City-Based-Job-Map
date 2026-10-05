"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

// A floating panel over the map: a 1 px Rule border and the over-the-map shadow, 4 px corners
// (design-system.md §4). Radix handles focus, Escape, and outside clicks.
const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

function PopoverContent({ className, align = "start", sideOffset = 6, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "popup-in z-30 max-h-[min(70vh,28rem)] w-72 overflow-auto rounded-md border border-rule bg-popover p-3 text-popover-foreground shadow-[0_1px_0_rgb(31_58_26/.08),0_6px_16px_rgb(31_58_26/.14)] outline-none",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
