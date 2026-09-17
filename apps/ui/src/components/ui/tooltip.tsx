import type * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-fit origin-(--radix-tooltip-content-transform-origin) animate-in rounded-md border border-border surface-glass glass-frost px-3 py-1.5 text-xs text-balance text-foreground shadow-floating fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {/*
          Radix's own polygon, filled — not a rotated, bordered square.

          This used to style the svg BOX into the arrow: `rotate-45`, two
          borders, a glass background, and a negative `translate-y` to tuck it
          under the bubble. That geometry only works for `side="top"`. Radix
          wraps the arrow in a span it rotates per side (180deg for a tooltip
          below its trigger), so on any other side the same classes drew the
          wrong two edges and pushed the diamond OUT of the bubble instead of
          into it. The polygon inside, meanwhile, had no `fill`, so it painted
          solid black over the glass.

          Letting Radix's polygon be the arrow makes all four sides correct for
          free. It costs the 1px border the square had; at 11x5 over a bubble
          this dark, that is not a trade worth four sides of geometry.

          Filled with the OPAQUE `popover` token, not one of the translucent
          `glass-*` stops. The bubble only reads light because `glass-frost`
          brightens the map showing through it; an arrow is a bare polygon with
          no backdrop-filter of its own, so at the glass stops' ~55% alpha it
          sank into the map and the tooltip looked like it had no arrow at all.
          `popover` sits between the gradient's two stops, so an opaque fill
          lands on the bubble's apparent tone.

          `-translate-y-px` tucks it one pixel INTO the bubble, so its base
          covers the content's 1px top border instead of perching on top of it
          — without that, the light border line runs underneath the arrow and
          the two read as a triangle stuck onto a box rather than one shape.
          The shift is side-agnostic: Radix rotates the arrow's wrapper so that
          it points outward on every side, which makes local -Y always point
          back into the content.
        */}
        <TooltipPrimitive.Arrow
          width={14}
          height={7}
          className="z-50 -translate-y-px fill-popover"
        />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
