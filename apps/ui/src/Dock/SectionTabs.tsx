import { cn } from "@/lib/utils";
import type { DockBadges, DockSection, DockTabId } from "./dockSections";

export interface SectionTabsProps {
  section: DockSection;
  /** The lit button. Never null: an open section always has one. */
  activeTab: DockTabId;
  badges: DockBadges;
  onSelectTab: (tab: DockTabId) => void;
  /** Close the section's buttons. */
  onCollapse: () => void;
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
 */
export default function SectionTabs({
  section,
  activeTab,
  badges,
  onSelectTab,
  onCollapse,
  activeTabRef,
}: SectionTabsProps) {
  return (
    <div
      className={cn(
        "flex items-stretch gap-0.5 self-center rounded-[10px] px-1",
        "bg-black/25 shadow-[inset_0_1px_2px_oklch(0_0_0/0.45),inset_0_0_0_1px_oklch(1_0_0/0.03)]"
      )}
    >
      <div
        className="flex items-center gap-0.5 py-1"
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
                "relative flex h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5",
                "text-[10.5px] font-semibold uppercase tracking-[0.06em]",
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

      <button
        type="button"
        onClick={onCollapse}
        aria-label={`Collapse ${section.label}`}
        title={`Collapse ${section.label} (Esc)`}
        className={cn(
          "my-1 flex w-7 shrink-0 items-center justify-center rounded-lg",
          "text-muted-foreground/70 transition-colors duration-fast ease-standard",
          "hover:bg-foreground/[0.06] hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
        )}
      >
        <svg viewBox="0 0 16 16" aria-hidden className="size-3" fill="none" stroke="currentColor">
          <path d="m4 4 8 8M12 4l-8 8" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
