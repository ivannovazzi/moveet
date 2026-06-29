/**
 * Shared types and OSM-tag parsing helpers used by the RoadNetwork
 * collaborators (GraphBuilder, SpatialIndex, PathfindingEngine).
 *
 * These were previously inlined in RoadNetwork.ts; they are extracted here so
 * the collaborators can share a single definition without importing the facade.
 */

import type { HighwayType } from "../../types";

/** A polyline of [lon, lat] coordinate pairs, as stored in the source GeoJSON. */
export type Street = [number, number][];

/** A named road aggregating all of its constituent street geometries and nodes. */
export interface Road {
  name: string;
  nameEn: string;
  nodeIds: Set<string>;
  streets: Street[];
}

const SMOOTHNESS_FACTORS: Record<string, number> = {
  excellent: 1.0,
  good: 0.9,
  intermediate: 0.75,
  bad: 0.6,
  very_bad: 0.45,
  horrible: 0.3,
  very_horrible: 0.2,
  impassable: 0.0,
};

export function parseSmoothness(raw: string | undefined): number {
  if (!raw) return 1.0;
  return SMOOTHNESS_FACTORS[raw] ?? 1.0;
}

const DEFAULT_SPEEDS: Record<HighwayType, number> = {
  motorway: 110,
  trunk: 80,
  primary: 60,
  secondary: 50,
  tertiary: 40,
  residential: 30,
  unclassified: 35,
  living_street: 20,
};

export function parseMaxSpeed(raw: string | undefined, highway: HighwayType): number {
  if (!raw) return DEFAULT_SPEEDS[highway];
  // Handle range format like "80-110" — use the average
  if (raw.includes("-")) {
    const parts = raw.split("-").map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return (parts[0] + parts[1]) / 2;
    }
  }
  const parsed = Number(raw);
  return isNaN(parsed) ? DEFAULT_SPEEDS[highway] : parsed;
}

export function parseOneway(value: string | undefined | null): "forward" | "reverse" | false {
  if (!value || value === "no" || value === "false" || value === "0") return false;
  if (value === "-1" || value === "reverse") return "reverse";
  return "forward"; // yes, true, 1
}

export const VALID_HIGHWAYS = new Set<string>([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "residential",
  "unclassified",
  "living_street",
]);
