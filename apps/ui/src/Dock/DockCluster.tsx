import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface DockClusterProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "className"
> {
  /** The cluster's icon (a lucide icon from `@/components/Icons`, unsized). */
  icon: React.ReactNode;
  /** Short label rendered under the icon. Omit for an icon-only cluster. */
  label?: string;
  /** Whether this cluster's drawer is currently open (or otherwise active). */
  active?: boolean;
  /**
   * Arbitrary badge content (a count pill, a colored status dot) pinned to
   * the cluster's top-right corner. The slot owns positioning — pass only
   * the visual content.
   */
  badge?: React.ReactNode;
  className?: string;
}

/**
 * Shared clickable dock segment: icon + optional label, with an
 * active/open visual state and an optional badge slot. Visual language is
 * lifted from `Controls/IconRail.tsx`'s icon buttons (accent-tinted active
 * state, ghost hover) but sized/labelled for a horizontal transport bar
 * instead of a vertical icon-only rail.
 */
const DockCluster = forwardRef<HTMLButtonElement, DockClusterProps>(function DockCluster(
  { icon, label, active = false, badge, className, ...rest },
  ref
) {
  if (import.meta.env.DEV && !label) {
    const hasLabel =
      typeof (rest as Record<string, unknown>)["aria-label"] === "string" ||
      typeof (rest as Record<string, unknown>)["aria-labelledby"] === "string";
    if (!hasLabel) {
      console.warn(
        "DockCluster without a visible `label` requires an `aria-label` (or `aria-labelledby`) for accessibility."
      );
    }
  }

  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={active}
      className={cn(
        "relative flex h-11 min-w-14 flex-col items-center justify-center gap-1 rounded-md px-3",
        "text-muted-foreground transition-[color,background-color,box-shadow] duration-fast ease-standard",
        "hover:bg-accent/15 hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active && "bg-accent/15 text-accent shadow-raised",
        className
      )}
      {...rest}
    >
      <span className="flex items-center justify-center [&_svg:not([class*='size-'])]:size-5">
        {icon}
      </span>
      {label && (
        <span className="text-[10px] font-medium uppercase leading-none tracking-wide">
          {label}
        </span>
      )}
      {badge && <span className="absolute -right-1 -top-1">{badge}</span>}
    </button>
  );
});

export default DockCluster;
