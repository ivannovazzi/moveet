import type { DockNavigation } from "@/hooks/useDockNavigation";
import DockSurface from "./DockSurface";
import SectionPill from "./SectionPill";
import { DOCK_SECTIONS, rollUpBadge, type DockBadges } from "./dockSections";

export interface SectionRailProps {
  navigation: DockNavigation;
  /** Live counts, keyed by tab id (see `dockSections`). */
  badges: DockBadges;
}

/**
 * The sections dock: four icon buttons — Fleet, Monitor, Session, Settings —
 * on one surface, the row's right wing.
 *
 * The wing is *always* those four keys in a 54px bar. Nothing unfolds inside
 * it: selecting a key opens that section in the console, and the section's own
 * views live in the console's tab bar. The keys used to expand into their views
 * inline, which grew the bar to two rows below ~1300px and pushed Session and
 * Settings off the end of the wing's half of the row. A row of four fixed
 * targets is the thing muscle memory is built on, so it is the thing that holds
 * still.
 *
 * The panel these keys used to open floated above this bar, anchored to
 * whichever key was lit and clamped sideways to dodge the inspector. It is the
 * console now (see `shell/Console`), which takes layout space instead of
 * floating — so there is nothing left here to anchor, and nothing left to dodge.
 */
export default function SectionRail({ navigation, badges }: SectionRailProps) {
  const { expanded, toggle } = navigation;
  return (
    <DockSurface data-dock="sections" className="items-center gap-0.5">
      {DOCK_SECTIONS.map((s) => (
        <SectionPill
          key={s.id}
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
  );
}
