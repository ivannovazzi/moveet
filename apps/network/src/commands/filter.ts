import path from "path";
import { osmium } from "../docker.js";

export const DEFAULT_ROAD_CLASSES = [
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "residential",
  "living_street",
  "unclassified",
] as const;

export type RoadClass = (typeof DEFAULT_ROAD_CLASSES)[number];

export interface FilterOptions {
  input: string;
  output: string;
  classes?: readonly string[];
}

export function buildFilterArgs(opts: FilterOptions): string[] {
  const classes = opts.classes ?? DEFAULT_ROAD_CLASSES;
  // Use one expression per class (osmium tags-filter ~regex is broken in v1.19+)
  const highwayExprs = [...classes].map((c) => `w/highway=${c}`);
  return [
    "tags-filter",
    path.basename(opts.input),
    // Road ways
    ...highwayExprs,
    "w/junction=roundabout",
    // POI nodes
    "n/amenity",
    "n/shop",
    "n/leisure",
    "n/craft",
    "n/office",
    // Traffic infrastructure nodes
    "n/highway=traffic_signals",
    "n/highway=bus_stop",
    // Turn restriction relations
    "r/type=restriction",
    "-o",
    path.basename(opts.output),
    "--overwrite",
  ];
}

export function filter(opts: FilterOptions): void {
  osmium(buildFilterArgs(opts), path.dirname(opts.input));
}
