import { useRef, type ReactNode } from "react";
import type { DockNavigation } from "@/hooks/useDockNavigation";
import AnchoredPanel from "./AnchoredPanel";
import DockSurface from "./DockSurface";
import SectionTabs from "./SectionTabs";
import SectionPill from "./SectionPill";
import {
  DOCK_SECTIONS,
  dockSection,
  rollUpBadge,
  type DockBadges,
  type DockSection,
  type DockSectionId,
  type DockTabId,
} from "./dockSections";

export interface SectionRailProps {
  navigation: DockNavigation;
  /** Live counts, keyed by tab id (see `dockSections`). */
  badges: DockBadges;
  /**
   * Selecting a tab. Not `navigation.selectTab` directly: some buttons are also
   * mode decisions (Fleet's Dispatch), so `Dock` wraps it.
   */
  onSelectTab: (tab: DockTabId) => void;
  /** Panel body for the open section's active tab. */
  renderPanel: (section: DockSection) => ReactNode;
}

/**
 * The sections dock: four icon buttons — Fleet, Monitor, Session, Settings —
 * on one surface, the row's right wing.
 *
 * Selecting one grows that section's own buttons *out of its button*, inline in
 * the same dock, and opens the panel above it. Nothing is hidden, reordered or
 * collapsed to make room: the dock gets longer exactly where the section is, so
 * the views read as belonging to the button you pressed rather than to the bar
 * in general.
 *
 * The wing lives inside its half of the row (see `Dock`'s grid), and when a
 * section's buttons need more width than the half has, they wrap onto a second
 * line — the dock grows *upward*, keeping its bottom edge and every button
 * visible. It used to scroll them behind a hidden scrollbar instead, which meant
 * "Heat Zones" and "Faults" simply did not exist on a 1440px screen.
 */
export default function SectionRail({
  navigation,
  badges,
  onSelectTab,
  renderPanel,
}: SectionRailProps) {
  const { expanded, tab, toggle, close } = navigation;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);
  // The panel hangs off the section's own button, not the lit tab: switching
  // views inside a section should change the contents, not slide the surface.
  const pillRefs = useRef(new Map<DockSectionId, HTMLButtonElement | null>());
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  anchorRef.current = expanded ? (pillRefs.current.get(expanded) ?? null) : null;

  const section = expanded ? dockSection(expanded) : null;

  return (
    // The panel is a *sibling* of the bar, not a child: a `backdrop-filter`
    // ancestor becomes a backdrop root, so a panel nested inside the blurred bar
    // samples an empty backdrop and renders with no blur at all. Positioning it
    // from this plain wrapper — same left edge, same height — lets it frost the
    // map behind it. Do not move it back inside `DockSurface`.
    <div className="relative flex min-w-0">
      <DockSurface
        ref={surfaceRef}
        data-dock="sections"
        // `h-auto` + `shrink`: the wing takes its half of the row and no more, and
        // grows *upward* when a section's buttons need a second line.
        className="h-auto min-h-[54px] min-w-0 shrink items-center gap-0.5"
      >
        {DOCK_SECTIONS.map((s) => {
          const open = expanded === s.id;
          return (
            <div key={s.id} className="flex min-w-0 items-center gap-0.5">
              <SectionPill
                ref={(el) => {
                  pillRefs.current.set(s.id, el);
                }}
                section={s}
                active={open}
                // Rolled-up counts are for collapsed keys only: once a section is
                // open, the count sits on the button that actually owns it, and
                // the same number in both places reads as two different problems.
                badge={open ? undefined : rollUpBadge(s.id, badges)}
                onClick={() => toggle(s.id)}
              />
              {open && section && tab && (
                <SectionTabs
                  section={section}
                  activeTab={tab}
                  badges={badges}
                  onSelectTab={onSelectTab}
                  activeTabRef={activeTabRef}
                />
              )}
            </div>
          );
        })}
      </DockSurface>

      <AnchoredPanel
        open={section !== null && tab !== null}
        id="dock-section-panel"
        aria-label={section?.label}
        eyebrow={
          section && tab
            ? `${section.label} › ${section.tabs.find((t) => t.id === tab)?.label ?? ""}`
            : undefined
        }
        anchorRef={anchorRef}
        originRef={surfaceRef}
        width={section?.panelWidth ?? "w-[420px]"}
        positionKey={`${expanded ?? "none"}:${tab ?? "none"}`}
        onClose={close}
      >
        {section ? renderPanel(section) : null}
      </AnchoredPanel>
    </div>
  );
}
