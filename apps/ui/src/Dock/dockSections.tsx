import type { ReactNode } from "react";
import { CarIcon, ChartIcon, GaugeIcon, RecordCircleIcon } from "@/components/Icons";

/**
 * The dock's sections and the buttons each one expands into.
 *
 * This table is the whole point of the dynamic dock: a section always expands
 * to the same bar, with the same buttons, in the same order, whatever the
 * state of the app. Nothing here is computed from live data (counts arrive
 * separately as badges), so the row's shape is predictable enough to build
 * muscle memory against.
 *
 * It is also the single registry the row, the panel, the keyboard and the
 * command palette all read, so a new tab is one entry here plus its content.
 */

export type DockSectionId = "fleet" | "monitor" | "session" | "settings";

export type FleetTabId = "list" | "groups" | "dispatch" | "jobs";
export type MonitorTabId = "incidents" | "analytics" | "geofences" | "heatzones" | "faults";
export type SessionTabId = "recordings" | "scenarios";
export type SettingsTabId = "feeds" | "advanced";

export type DockTabId = FleetTabId | MonitorTabId | SessionTabId | SettingsTabId;

export interface DockTab {
  id: DockTabId;
  label: string;
}

export interface DockSection {
  id: DockSectionId;
  /** Shown on the collapsed pill and as the expanded dock's eyebrow. */
  label: string;
  icon: ReactNode;
  tabs: DockTab[];
  /**
   * Width of the panel this section opens. Per-section, because one 384px box
   * for every panel is what forced the vehicle list into a fixed-height hack
   * and squeezed the analytics charts.
   */
  panelWidth: string;
}

export const DOCK_SECTIONS: DockSection[] = [
  {
    id: "fleet",
    label: "Fleet",
    icon: <CarIcon />,
    tabs: [
      { id: "list", label: "List" },
      { id: "groups", label: "Groups" },
      { id: "dispatch", label: "Dispatch" },
      { id: "jobs", label: "Jobs" },
    ],
    panelWidth: "w-[420px]",
  },
  {
    id: "monitor",
    label: "Monitor",
    icon: <ChartIcon />,
    tabs: [
      { id: "incidents", label: "Incidents" },
      { id: "analytics", label: "Analytics" },
      { id: "geofences", label: "Geofences" },
      { id: "heatzones", label: "Heat zones" },
      { id: "faults", label: "Faults" },
    ],
    // Analytics carries charts; they were the worst served by the old shared box.
    panelWidth: "w-[480px]",
  },
  {
    id: "session",
    label: "Session",
    icon: <RecordCircleIcon />,
    tabs: [
      { id: "recordings", label: "Recordings" },
      { id: "scenarios", label: "Scenarios" },
    ],
    panelWidth: "w-[400px]",
  },
  {
    id: "settings",
    label: "Settings",
    icon: <GaugeIcon />,
    // Layer visibility is not here: it lives on the map's own left rail as icon
    // keys (see Map/VisibilityRail), where it is one press from what it changes.
    tabs: [
      { id: "feeds", label: "Feeds & sinks" },
      { id: "advanced", label: "Advanced" },
    ],
    panelWidth: "w-[380px]",
  },
];

const SECTION_BY_ID = new Map(DOCK_SECTIONS.map((section) => [section.id, section]));

export function dockSection(id: DockSectionId): DockSection {
  const section = SECTION_BY_ID.get(id);
  if (!section) throw new Error(`Unknown dock section: ${id}`);
  return section;
}

/** The tab a section opens on before the operator has chosen one. */
export function defaultTab(id: DockSectionId): DockTabId {
  return dockSection(id).tabs[0].id;
}

/** True when `tab` belongs to `section` — guards palette/URL-driven opens. */
export function sectionHasTab(id: DockSectionId, tab: DockTabId): boolean {
  return dockSection(id).tabs.some((t) => t.id === tab);
}

/** A live count pinned to a tab button (and rolled up onto the collapsed pill). */
export interface DockBadge {
  count: number;
  tone: "accent" | "error";
  /** What the number counts, in words — the pill/button's accessible name. */
  label: string;
}

export type DockBadges = Partial<Record<DockTabId, DockBadge>>;

/**
 * The badge a collapsed pill shows: the loudest of its tabs' badges. Error
 * tone always outranks accent, then the larger count wins, so a breached SLA
 * can never hide behind an informational selection count.
 */
export function rollUpBadge(id: DockSectionId, badges: DockBadges): DockBadge | undefined {
  let winner: DockBadge | undefined;
  for (const tab of dockSection(id).tabs) {
    const badge = badges[tab.id];
    if (!badge || badge.count <= 0) continue;
    if (!winner) {
      winner = badge;
      continue;
    }
    const outranks =
      (badge.tone === "error" && winner.tone !== "error") ||
      (badge.tone === winner.tone && badge.count > winner.count);
    if (outranks) winner = badge;
  }
  return winner;
}
