import { useRef, type ReactNode } from "react";
import type { DockNavigation } from "@/hooks/useDockNavigation";
import AnchoredPanel from "./AnchoredPanel";
import DockSurface from "./DockSurface";
import SectionTabs from "./SectionTabs";
import SectionPill from "./SectionPill";
import { PanelHeaderRow } from "./DockPanelKit";
import {
  DOCK_SECTIONS,
  dockSection,
  rollUpBadge,
  type DockBadges,
  type DockSection,
  type DockSectionId,
  type DockTabId,
} from "./dockSections";

/**
 * One width for every section panel.
 *
 * Per-section widths (420 / 480 / 400 / 380) made the surface resize as well as
 * re-anchor whenever you stepped Fleet → Monitor → Settings, which read as four
 * different panels rather than one panel showing four things. The registry
 * still carries `panelWidth`; nothing reads it.
 */
const PANEL_WIDTH = "w-[520px]";

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
  /**
   * Optional content for the header's right slot, before the close button — a
   * health chip, a count, a small action that belongs to the whole section
   * rather than to one of its views. Panels supply it without having to reach
   * into the header themselves.
   */
  renderHeaderRight?: (section: DockSection) => ReactNode;
}

/**
 * The sections dock: four icon buttons — Fleet, Monitor, Session, Settings —
 * on one surface, the row's right wing.
 *
 * The wing is *always* those four keys in a 54px bar. Nothing unfolds inside
 * it: selecting a key opens the section's panel above, and the section's own
 * views live in that panel's header. The keys used to expand into their views
 * inline, which grew the bar to two rows below ~1300px and pushed Session and
 * Settings off the end of the wing's half of the row. A row of four fixed
 * targets is the thing muscle memory is built on, so it is the thing that holds
 * still.
 *
 * The panel hangs off the *bar's* right edge rather than off whichever key you
 * pressed, so it stays exactly where it is while you step between sections —
 * only its contents change. The accent pointer underneath still runs back down
 * to the lit key, so the relationship stays visible without the surface moving.
 */
export default function SectionRail({
  navigation,
  badges,
  onSelectTab,
  renderPanel,
  renderHeaderRight,
}: SectionRailProps) {
  const { expanded, tab, toggle, close } = navigation;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pillRefs = useRef(new Map<DockSectionId, HTMLButtonElement | null>());
  // The pointer points at the lit key; the surface itself doesn't move with it.
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
      <DockSurface ref={surfaceRef} data-dock="sections" className="items-center gap-0.5">
        {DOCK_SECTIONS.map((s) => (
          <SectionPill
            key={s.id}
            ref={(el) => {
              pillRefs.current.set(s.id, el);
            }}
            section={s}
            active={expanded === s.id}
            // Rolled-up counts are for collapsed keys only: once a section is
            // open, the count sits on the view that actually owns it, and the
            // same number in both places reads as two different problems.
            badge={expanded === s.id ? undefined : rollUpBadge(s.id, badges)}
            onClick={() => toggle(s.id)}
          />
        ))}
      </DockSurface>

      <AnchoredPanel
        open={section !== null && tab !== null}
        id="dock-section-panel"
        aria-label={section?.label}
        header={
          section && tab ? (
            <PanelHeaderRow
              icon={section.icon}
              title={section.label}
              right={renderHeaderRight?.(section)}
              onClose={close}
              closeLabel={`Close ${section.label}`}
            >
              <SectionTabs
                section={section}
                activeTab={tab}
                badges={badges}
                onSelectTab={onSelectTab}
              />
            </PanelHeaderRow>
          ) : undefined
        }
        anchorRef={anchorRef}
        originRef={surfaceRef}
        width={PANEL_WIDTH}
        align="origin-right"
        avoidInsetKey="inspector"
        positionKey={`${expanded ?? "none"}:${tab ?? "none"}`}
        // The one panel big enough to matter to the camera: 520px of the right
        // edge and most of the height below it (see `mapInsets`).
        insetKey="dock-section-panel"
        onClose={close}
      >
        {section ? renderPanel(section) : null}
      </AnchoredPanel>
    </div>
  );
}
