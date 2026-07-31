import { cn } from "@/lib/utils";
import type { DockBadges, DockSection, DockTabId } from "./dockSections";

export interface SectionTabsProps {
  section: DockSection;
  /** The lit button. Never null: an open section always has one. */
  activeTab: DockTabId;
  badges: DockBadges;
  onSelectTab: (tab: DockTabId) => void;
  /** Ref for the active tab button, so the panel can line up with it. */
  activeTabRef?: React.RefObject<HTMLButtonElement | null>;
}

/**
 * The open section's own buttons, unfolding inside the sections dock beside the
 * key that owns them. The views that used to be a tab strip inside a floating
 * panel are dock buttons now, so the thing you press to change view is the same
 * kind of object at every level, and the panel above holds content only.
 *
 * The group sits in a recessed well — a darker inset trough — so it reads as a
 * module that came *out of* the lit key rather than as more of the bar. The
 * button set comes from the section registry and never varies with state:
 * counts arrive as badges on fixed buttons rather than adding or removing them.
 *
 * The buttons wrap rather than scroll. If the wing's half of the row is too
 * narrow for five of them, the well becomes two lines and the dock gets taller;
 * nothing ends up behind an edge.
 *
 * There is no close button in here. The lit key collapses the section (it is a
 * toggle), Escape collapses it, and the palette has an action for it — a fourth
 * way cost 32px of the well's width and taught nothing.
 *
 * Labels are sentence case. Micro-caps are reserved for the things that report
 * state — the mode name, a panel's eyebrow, the corner lamps — so caps in this
 * interface mean "this is telling you something", never "this is a button".
 */
export default function SectionTabs({
  section,
  activeTab,
  badges,
  onSelectTab,
  activeTabRef,
}: SectionTabsProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 animate-fade-in-fast items-stretch self-center rounded-[10px] px-[3px]",
        "bg-black/25 shadow-[inset_0_1px_2px_oklch(0_0_0/0.45),inset_0_0_0_1px_oklch(1_0_0/0.03)]"
      )}
    >
      <div
        className="flex min-w-0 flex-wrap items-center gap-0.5 py-1"
        role="tablist"
        aria-label={`${section.label} views`}
      >
        {section.tabs.map((tab) => {
          const selected = tab.id === activeTab;
          const badge = badges[tab.id];
          return (
            <button
              key={tab.id}
              ref={selected ? activeTabRef : undefined}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSelectTab(tab.id)}
              title={badge && badge.count > 0 ? `${tab.label} — ${badge.label}` : tab.label}
              className={cn(
                "relative flex h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2",
                "text-[11.5px] font-medium",
                "transition-[color,background-color,box-shadow] duration-fast ease-standard",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
                selected
                  ? cn(
                      "bg-accent/[0.14] text-accent",
                      "shadow-[inset_0_0_0_1px_var(--color-accent-line,oklch(0.62_0.15_250/0.30)),0_1px_0_oklch(1_0_0/0.04)]"
                    )
                  : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
              )}
            >
              {tab.label}
              {badge && badge.count > 0 && (
                <span
                  className={cn(
                    "flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-[3px]",
                    "font-mono text-[9px] font-bold leading-none tabular-nums text-white",
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
    </div>
  );
}
