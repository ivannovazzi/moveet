import { cn } from "@/lib/utils";
import type { DockBadges, DockSection, DockTabId } from "./dockSections";

export interface SectionTabsProps {
  section: DockSection;
  /** The lit button. Never null: an open section always has one. */
  activeTab: DockTabId;
  badges: DockBadges;
  onSelectTab: (tab: DockTabId) => void;
  className?: string;
}

/**
 * The open section's views, as a compact strip inside the panel's header row.
 *
 * They used to unfold *inside* the dock bar, beside the key that owns them.
 * That looked right at 1440px and fell apart below it: five buttons plus four
 * section keys wrapped onto a second line, the 54px bar grew to roughly 100px,
 * and Session/Settings were pushed off the wing's half of the row. The row of
 * four keys is the one thing in the dock that must never change shape, so the
 * views moved up into the surface they actually switch.
 *
 * The strip scrolls rather than wraps — a section with five views stays one
 * line tall, so the panel's header height is the same for Fleet and Monitor.
 * Counts ride on fixed buttons rather than adding or removing them, so the
 * strip's shape never depends on live data either.
 *
 * Labels are sentence case. Micro-caps are reserved for the things that report
 * state — the mode name, the corner lamps — so caps in this interface mean
 * "this is telling you something", never "this is a button".
 */
export default function SectionTabs({
  section,
  activeTab,
  badges,
  onSelectTab,
  className,
}: SectionTabsProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center gap-px overflow-x-auto",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
      role="tablist"
      aria-label={`${section.label} views`}
    >
      {section.tabs.map((tab) => {
        const selected = tab.id === activeTab;
        const badge = badges[tab.id];
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelectTab(tab.id)}
            title={badge && badge.count > 0 ? `${tab.label} — ${badge.label}` : tab.label}
            className={cn(
              "relative flex h-[24px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-1.5",
              "text-meta font-medium",
              "transition-[color,background-color,box-shadow] duration-fast ease-standard",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
              selected
                ? cn(
                    "bg-accent/[0.14] text-accent",
                    "shadow-[inset_0_0_0_1px_var(--color-accent-line,oklch(0.62_0.15_250/0.30))]"
                  )
                : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
            )}
          >
            {tab.label}
            {badge && badge.count > 0 && (
              <span
                className={cn(
                  "flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-[3px]",
                  "font-mono text-micro font-bold leading-none tabular-nums text-white",
                  badge.tone === "error" ? "bg-status-error" : "bg-accent"
                )}
              >
                {badge.count > 9 ? "9+" : badge.count}
                <span className="sr-only">{badge.label}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
