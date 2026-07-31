import type { ReactNode } from "react";
import type { Modifiers } from "@/types";
import {
  CarIcon,
  Flame,
  GaugeIcon,
  GeofenceIcon,
  JobIcon,
  LayersIcon,
  POI,
  Road,
  TrafficIcon,
  TrailIcon,
} from "@/components/Icons";

/**
 * What the map can draw, as one table.
 *
 * The left rail renders it as icon keys and the command palette turns it into
 * "Show/Hide …" entries, so a new layer is one row here and it appears in both.
 * The previous split — a labelled switch list in the Settings panel plus a
 * hand-maintained copy in `commands.tsx` — had already drifted: Density and Jobs
 * were toggleable in the panel and missing from the palette.
 *
 * Order is the reading order of the rail, grouped loosely from the ground up:
 * the road network, then what moves on it, then the overlays drawn over both.
 */
export interface VisibilityLayer {
  key: keyof Modifiers;
  /** Accessible name of the key, and the noun in the palette entry. */
  label: string;
  icon: ReactNode;
}

export const VISIBILITY_LAYERS: VisibilityLayer[] = [
  { key: "showDirections", label: "Network", icon: <Road /> },
  { key: "showTrafficOverlay", label: "Traffic Colours", icon: <TrafficIcon /> },
  { key: "showVehicles", label: "Vehicles", icon: <CarIcon /> },
  { key: "showDensity", label: "Density", icon: <LayersIcon /> },
  { key: "showJobs", label: "Jobs", icon: <JobIcon /> },
  { key: "showBreadcrumbs", label: "Trails", icon: <TrailIcon /> },
  { key: "showHeatmap", label: "Heatmap", icon: <Flame /> },
  { key: "showHeatzones", label: "Zones", icon: <GeofenceIcon /> },
  { key: "showPOIs", label: "POIs", icon: <POI /> },
  { key: "showSpeedLimits", label: "Speed Limits", icon: <GaugeIcon /> },
];
