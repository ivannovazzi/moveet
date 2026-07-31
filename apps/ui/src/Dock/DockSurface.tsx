import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export type DockSurfaceVariant = "bar" | "panel";

export interface DockSurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  /** `bar` for a dock row surface, `panel` for floating content above one. */
  variant?: DockSurfaceVariant;
}

/**
 * The one glass surface every floating piece of the dock is made of: the main
 * dock, the sections dock, and the panels that open above them. Same border,
 * same blur, same edge, so the dock reads as one instrument however many of its
 * parts are on screen.
 *
 * The edge is the detail that makes it feel machined rather than drawn: a 1px
 * inner highlight along the top (light from above) over a soft inner shade at
 * the bottom, on top of the blur. `panel` is stronger and more blurred than
 * `bar` — it sits above the bars and holds reading content, so it has to
 * separate from the map without going opaque.
 */
const EDGE = "shadow-[inset_0_1px_0_oklch(1_0_0/0.07),inset_0_-1px_0_oklch(0_0_0/0.35)]";

const DockSurface = forwardRef<HTMLDivElement, DockSurfaceProps>(function DockSurface(
  { variant = "bar", className, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        "border border-border",
        variant === "bar" &&
          cn(
            "flex h-[54px] shrink-0 items-stretch rounded-[14px] p-1.5",
            "surface-glass backdrop-blur-xl",
            // Elevation plus the machined edge, in one composited shadow.
            "shadow-[0_18px_40px_-12px_oklch(0_0_0/0.65),inset_0_1px_0_oklch(1_0_0/0.07),inset_0_-1px_0_oklch(0_0_0/0.35)]"
          ),
        variant === "panel" &&
          cn(
            "overflow-hidden rounded-[12px] surface-glass-strong backdrop-blur-2xl backdrop-saturate-150",
            "shadow-[0_28px_60px_-16px_oklch(0_0_0/0.7)]",
            EDGE
          ),
        className
      )}
      {...rest}
    />
  );
});

export default DockSurface;
