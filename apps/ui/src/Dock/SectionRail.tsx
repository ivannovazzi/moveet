import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { DockNavigation } from "@/hooks/useDockNavigation";
import AnchoredPanel from "./AnchoredPanel";
import DockSurface from "./DockSurface";
import SectionTabs from "./SectionTabs";
import SectionPill from "./SectionPill";
import { useAvailableWidth } from "./dockRowLayout";
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
 * on one surface beside the main dock.
 *
 * Selecting one grows that section's own buttons *out of its button*, inline in
 * the same dock, and opens the panel above it. Nothing is hidden, reordered or
 * collapsed to make room: the dock gets longer exactly where the section is, so
 * the views read as belonging to the button you pressed rather than to the bar
 * in general. The dock caps itself at the viewport edge and scrolls its section
 * buttons instead of pushing itself off screen.
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
  const maxWidth = useAvailableWidth(surfaceRef, section !== null);

  return (
    <DockSurface ref={surfaceRef} className="relative gap-0.5" style={{ maxWidth }}>
      {DOCK_SECTIONS.map((s) => {
        const open = expanded === s.id;
        return (
          <div key={s.id} className="flex min-w-0 items-stretch gap-0.5">
            <SectionPill
              ref={(el) => {
                pillRefs.current.set(s.id, el);
              }}
              section={s}
              active={open}
              badge={rollUpBadge(s.id, badges)}
              onClick={() => toggle(s.id)}
            />
            {open && section && tab && (
              <div
                className={cn(
                  "flex min-w-0 animate-fade-in-fast items-stretch",
                  "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                )}
              >
                <div className="mx-1 my-2 w-px shrink-0 self-stretch bg-border-soft" />
                <SectionTabs
                  section={section}
                  activeTab={tab}
                  badges={badges}
                  onSelectTab={onSelectTab}
                  onCollapse={close}
                  activeTabRef={activeTabRef}
                />
              </div>
            )}
          </div>
        );
      })}

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
    </DockSurface>
  );
}
