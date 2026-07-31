import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface DockClusterProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  /** The cluster's icon (a lucide icon from `@/components/Icons`, unsized). */
  icon: React.ReactNode;
  /** Short label rendered under the icon. Omit for an icon-only cluster. */
  label?: string;
  /** Whether this cluster's panel is currently open (drives the accent state). */
  active?: boolean;
  /**
   * Arbitrary badge content (a count pill, a colored health dot) pinned to the
   * cluster's top-right corner. The slot owns positioning — pass only the
   * visual content.
   */
  badge?: React.ReactNode;
  /**
   * What the badge counts, in words ("2 jobs past SLA"). Pass it whenever a
   * badge is passed: a bare red "2" reads the same whether it is incidents or
   * misbehaving devices, and a screen reader gets nothing from the pill at all.
   */
  badgeLabel?: string;
  /** Id of the panel surface this cluster discloses. */
  panelId?: string;
  className?: string;
}

/**
 * A dock cluster button: icon + small uppercase label stacked vertically,
 * with an active/open accent state and an optional badge slot. Tight,
 * technical proportions — 42px tall, 9px label, 17px icon — so the clusters sit
 * compactly in one bar.
 *
 * Openness is announced as `aria-expanded` + `aria-controls`, not
 * `aria-pressed`: these buttons disclose a panel, they don't toggle a setting.
 */
const DockCluster = forwardRef<HTMLButtonElement, DockClusterProps>(function DockCluster(
  { icon, label, active = false, badge, badgeLabel, panelId = "dock-panel", className, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={active}
      aria-controls={panelId}
      className={cn(
        "relative flex h-[42px] min-w-[52px] flex-col items-center justify-center gap-[3px] rounded-lg px-2.5",
        "text-muted-foreground transition-[color,background-color,box-shadow] duration-fast ease-standard",
        "hover:bg-foreground/[0.035] hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
        active &&
          "bg-accent/15 text-accent shadow-[inset_0_0_0_1px_var(--color-accent-line,oklch(0.62_0.15_250/0.32))]",
        className
      )}
      {...rest}
    >
      <span className="flex items-center justify-center [&_svg]:size-[17px]">{icon}</span>
      {label && (
        <span className="text-[9px] font-semibold uppercase leading-none tracking-[0.06em]">
          {label}
        </span>
      )}
      {badge && (
        <span className="absolute right-1 top-px" title={badgeLabel}>
          {badge}
          {badgeLabel && <span className="sr-only">{badgeLabel}</span>}
        </span>
      )}
    </button>
  );
});

export default DockCluster;
