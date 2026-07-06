import type { FC, SVGProps } from "react";
import {
  AlertIcon,
  CarIcon,
  ChartIcon,
  EyeIcon,
  Gear,
  GeofenceIcon,
  LayersIcon,
  RecordCircleIcon,
  ScenarioIcon,
} from "@/components/Icons";

export type PanelId =
  | "vehicles"
  | "fleets"
  | "incidents"
  | "geofences"
  | "recordings"
  | "scenarios"
  | "toggles"
  | "analytics"
  | "adapter";

export type PanelGroup = "Fleet" | "Operations" | "Monitor" | "System";

export interface PanelMeta {
  icon: FC<SVGProps<SVGSVGElement>>;
  label: string;
  group: PanelGroup;
}

/**
 * Single source of truth for the sliding side panels: NavRail renders its
 * grouped rail from this registry and App renders the aside content by id.
 * Adding a panel = one entry here + one render case in App's panel switch.
 */
export const PANELS: Record<PanelId, PanelMeta> = {
  vehicles: { icon: CarIcon, label: "Vehicles", group: "Fleet" },
  fleets: { icon: LayersIcon, label: "Fleets", group: "Fleet" },
  incidents: { icon: AlertIcon, label: "Incidents", group: "Operations" },
  geofences: { icon: GeofenceIcon, label: "Geofences", group: "Operations" },
  recordings: { icon: RecordCircleIcon, label: "Recordings", group: "Operations" },
  scenarios: { icon: ScenarioIcon, label: "Scenarios", group: "Operations" },
  toggles: { icon: EyeIcon, label: "Visibility", group: "Monitor" },
  analytics: { icon: ChartIcon, label: "Analytics", group: "Monitor" },
  adapter: { icon: Gear, label: "Adapter", group: "System" },
};

export const PANEL_IDS = Object.keys(PANELS) as PanelId[];

/** Main-rail group order; "System" panels render pinned at the rail bottom. */
const RAIL_GROUP_ORDER = [
  "Fleet",
  "Operations",
  "Monitor",
] as const satisfies readonly PanelGroup[];

/** Ordered nav-rail groups (panel order within a group = registry declaration order). */
export const PANEL_GROUPS = RAIL_GROUP_ORDER.map((label) => ({
  label,
  ids: PANEL_IDS.filter((id) => PANELS[id].group === label),
}));

/** Panels pinned to the bottom of the rail (the "System" group). */
export const BOTTOM_PANEL_IDS = PANEL_IDS.filter((id) => PANELS[id].group === "System");
