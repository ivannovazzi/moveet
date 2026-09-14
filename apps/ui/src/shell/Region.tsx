import { cn } from "@/lib/utils";

/**
 * One surface's cell in the shell grid.
 *
 * A region is a *box the size of its contents*, parked in a grid track. That
 * matters twice over:
 *
 *  • **Pointer events.** The grid covers the whole map, so it is
 *    `pointer-events-none` and each region turns them back on. A region sized
 *    to its track instead of its contents would swallow drags across an empty
 *    half of the map; sized to its contents it swallows exactly the surface.
 *  • **Overlap.** Regions in different tracks cannot overlap, because the
 *    tracks are sized from the regions. That is the whole point of the grid:
 *    non-overlap stops being a convention between hand-tuned clearance tokens
 *    and becomes a property of the layout.
 *
 * `interactive={false}` is for a surface that deliberately stays click-through
 * (the legend column covers a tall strip of map it must not steal drags from)
 * and manages `pointer-events` on its own inner parts.
 */
export interface RegionProps {
  children: React.ReactNode;
  /** Where the region sits along the track's inline axis. */
  justify?: "start" | "center" | "end" | "stretch";
  /** Where it sits along the block axis. */
  align?: "start" | "center" | "end" | "stretch";
  /** False when the surface owns its own `pointer-events` (see above). */
  interactive?: boolean;
  className?: string;
}

const JUSTIFY = {
  start: "justify-self-start",
  center: "justify-self-center",
  end: "justify-self-end",
  stretch: "justify-self-stretch",
} as const;

const ALIGN = {
  start: "self-start",
  center: "self-center",
  end: "self-end",
  stretch: "self-stretch",
} as const;

export default function Region({
  children,
  justify = "start",
  align = "start",
  interactive = true,
  className,
}: RegionProps) {
  return (
    <div
      className={cn(
        "min-h-0 min-w-0",
        interactive ? "pointer-events-auto" : "pointer-events-none",
        JUSTIFY[justify],
        ALIGN[align],
        className
      )}
    >
      {children}
    </div>
  );
}
