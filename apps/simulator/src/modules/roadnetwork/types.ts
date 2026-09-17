/**
 * Shared types and OSM-tag parsing helpers used by the RoadNetwork
 * collaborators (GraphBuilder, SpatialIndex, PathfindingEngine).
 *
 * These were previously inlined in RoadNetwork.ts; they are extracted here so
 * the collaborators can share a single definition without importing the facade.
 */

import type { HighwayType } from "../../types";
import type { NodeControl } from "../pathfinding/cost";

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

const KMH_PER_MPH = 1.609344;
const KMH_PER_KNOT = 1.852;
/** OSM `walk` — walking pace. */
const WALK_KMH = 7;
/** OSM `none` (e.g. German Autobahn) — priced at the common advisory speed. */
const NO_LIMIT_KMH = 130;

const mph = (v: number) => v * KMH_PER_MPH;

/**
 * Implicit legal limits (km/h) for OSM country-coded zone values such as
 * `DE:urban` or `US:urban`, as used in `maxspeed`, `maxspeed:type`,
 * `source:maxspeed` and `zone:maxspeed`. Keys are `<CC>:<zone>`; the empty
 * country `":zone"` entries are the generic fallback for countries not listed.
 * A subdivision code (`US-NY:urban`) falls back to its country (`US:urban`).
 */
const IMPLICIT_LIMITS: Record<string, number> = {
  ":urban": 50,
  ":rural": 90,
  ":trunk": 100,
  ":motorway": 120,
  ":living_street": WALK_KMH,
  ":walk": WALK_KMH,
  ":bicycle_road": 30,
  "US:urban": mph(25),
  "US:rural": mph(55),
  "US:motorway": mph(65),
  "GB:urban": mph(30),
  "GB:nsl_restricted": mph(30),
  "GB:nsl_single": mph(60),
  "GB:nsl_dual": mph(70),
  "GB:motorway": mph(70),
  "UK:urban": mph(30),
  "UK:nsl_restricted": mph(30),
  "UK:nsl_single": mph(60),
  "UK:nsl_dual": mph(70),
  "UK:motorway": mph(70),
  "DE:urban": 50,
  "DE:rural": 100,
  "DE:motorway": NO_LIMIT_KMH,
  "FR:urban": 50,
  "FR:rural": 80,
  "FR:motorway": 130,
  "IT:urban": 50,
  "IT:rural": 90,
  "IT:trunk": 110,
  "IT:motorway": 130,
  "ES:urban": 50,
  "ES:rural": 90,
  "ES:motorway": 120,
  "NL:urban": 50,
  "NL:rural": 80,
  "NL:motorway": 100,
  "BE:urban": 50,
  "BE:rural": 90,
  "BE-VLG:rural": 70,
  "BE:motorway": 120,
  "AT:urban": 50,
  "AT:rural": 100,
  "AT:motorway": 130,
  "CH:urban": 50,
  "CH:rural": 80,
  "CH:trunk": 100,
  "CH:motorway": 120,
  "PL:urban": 50,
  "PL:rural": 90,
  "PL:motorway": 140,
  "RU:urban": 60,
  "RU:rural": 90,
  "RU:motorway": 110,
  "RU:living_street": 20,
  "CA:urban": 50,
  "CA:rural": 80,
  "AU:urban": 50,
  "AU:rural": 100,
};

/** Countries whose signed limits are in mph. */
const MPH_COUNTRIES = new Set(["US", "GB", "UK", "LR", "MM"]);

/** Values that carry no numeric information: fall through to other tags / the class default. */
const NON_NUMERIC_VALUES = new Set(["signals", "variable", "implicit", "national", "sign"]);

/** Resolves a `<CC>[-<SUB>]:<zone>` code to km/h, or undefined when unknown. */
function parseImplicitCode(code: string): number | undefined {
  const colon = code.indexOf(":");
  if (colon <= 0) return undefined;
  const region = code.slice(0, colon).toUpperCase();
  const zone = code.slice(colon + 1).toLowerCase();

  const country = region.split("-")[0];

  // `DE:zone30`, `DE:zone:30`, `DE:30` — an explicit zone limit in the country's unit
  const zoneMatch = /^(?:zone:?)?(\d+(?:\.\d+)?)$/.exec(zone);
  if (zoneMatch) {
    const v = Number(zoneMatch[1]);
    if (!(v > 0)) return undefined;
    return MPH_COUNTRIES.has(country) ? mph(v) : v;
  }

  return (
    IMPLICIT_LIMITS[`${region}:${zone}`] ??
    IMPLICIT_LIMITS[`${country}:${zone}`] ??
    IMPLICIT_LIMITS[`:${zone}`]
  );
}

/** Parses a single speed with an optional unit suffix (`25 mph`, `10 knots`, `60 km/h`). */
function parseSingleSpeed(value: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*(mph|knots?|kn|km\/h|kmh|kph)?$/i.exec(value);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!(n > 0)) return undefined;
  const unit = m[2]?.toLowerCase();
  if (unit === "mph") return n * KMH_PER_MPH;
  if (unit === "knot" || unit === "knots" || unit === "kn") return n * KMH_PER_KNOT;
  return n;
}

/**
 * Parses one OSM speed tag value to km/h, or undefined when it carries no
 * usable limit. Handles plain km/h numbers, `mph`/`knots` suffixes, ranges
 * (averaged, e.g. `80-110`, `20-30 mph`), semicolon lists (lowest wins),
 * `walk`/`none`, and country-coded implicit limits (`DE:urban`).
 */
function parseSpeedTag(raw: unknown): number | undefined {
  if (typeof raw !== "string" && typeof raw !== "number") return undefined;
  const value = String(raw).trim();
  if (!value) return undefined;

  if (value.includes(";")) {
    let min: number | undefined;
    for (const part of value.split(";")) {
      const v = parseSpeedTag(part);
      if (v !== undefined && (min === undefined || v < min)) min = v;
    }
    return min;
  }

  const lower = value.toLowerCase();
  if (lower === "walk") return WALK_KMH;
  if (lower === "none") return NO_LIMIT_KMH;
  if (NON_NUMERIC_VALUES.has(lower)) return undefined;
  if (value.includes(":")) return parseImplicitCode(value);

  // Range like "80-110" or "20-30 mph" — average, carrying the trailing unit
  const range = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(.*)$/.exec(value);
  if (range) {
    const lo = parseSingleSpeed(`${range[1]} ${range[3]}`.trim());
    const hi = parseSingleSpeed(`${range[2]} ${range[3]}`.trim());
    return lo !== undefined && hi !== undefined ? (lo + hi) / 2 : undefined;
  }

  return parseSingleSpeed(value);
}

/** Parses an OSM `maxspeed` value to km/h, falling back to the highway class default. */
export function parseMaxSpeed(raw: string | undefined, highway: HighwayType): number {
  return parseSpeedTag(raw) ?? DEFAULT_SPEEDS[highway];
}

/** Tags carrying an implicit-limit code when no explicit `maxspeed` is present. */
const IMPLICIT_SOURCE_TAGS = ["maxspeed:type", "source:maxspeed", "zone:maxspeed"] as const;

/**
 * Resolves the posted limit (km/h) for one travel direction of a way.
 *
 * Precedence: `maxspeed:<direction>` → `maxspeed` → an implicit code in
 * `maxspeed:type` / `source:maxspeed` / `zone:maxspeed` → highway class default.
 * `direction` is relative to the way's geometry: `forward` for the
 * first→last-coordinate edge, `backward` for the reverse edge.
 */
export function resolveMaxSpeed(
  props: Record<string, unknown> | null | undefined,
  highway: HighwayType,
  direction: "forward" | "backward"
): number {
  if (props) {
    const directional = parseSpeedTag(props[`maxspeed:${direction}`]);
    if (directional !== undefined) return directional;
    const explicit = parseSpeedTag(props.maxspeed);
    if (explicit !== undefined) return explicit;
    for (const tag of IMPLICIT_SOURCE_TAGS) {
      const raw = props[tag];
      if (typeof raw !== "string" || !raw.includes(":")) continue;
      const implicit = parseImplicitCode(raw.trim());
      if (implicit !== undefined) return implicit;
    }
  }
  return DEFAULT_SPEEDS[highway];
}

/**
 * Free-flow factor per highway class: the typical uncongested travel speed as a
 * fraction of the posted limit. Posted limits overstate real speeds (side
 * friction, unsignalized junctions, parking, pedestrians), more so on local
 * streets than on grade-separated roads. Always in (0, 1], so the free-flow
 * speed never exceeds the posted limit. Overridable via `FREE_FLOW_FACTORS`.
 */
export const DEFAULT_FREE_FLOW_FACTORS: Readonly<Record<HighwayType, number>> = Object.freeze({
  motorway: 0.9,
  trunk: 0.8,
  primary: 0.7,
  secondary: 0.7,
  tertiary: 0.65,
  unclassified: 0.65,
  residential: 0.6,
  living_street: 0.6,
});

/**
 * Parses a `class=factor[,class=factor...]` override list (e.g.
 * `residential=0.5,motorway=0.95`) over {@link DEFAULT_FREE_FLOW_FACTORS}.
 * Throws on an unknown class or a factor outside (0, 1].
 */
export function parseFreeFlowFactors(raw: string | undefined): Record<HighwayType, number> {
  const factors: Record<HighwayType, number> = { ...DEFAULT_FREE_FLOW_FACTORS };
  if (!raw?.trim()) return factors;
  for (const entry of raw.split(",")) {
    if (!entry.trim()) continue;
    const [key, val, ...rest] = entry.split("=").map((p) => p.trim());
    if (val === undefined || rest.length > 0) {
      throw new Error(`Invalid free-flow factor entry "${entry.trim()}" (expected class=factor)`);
    }
    if (!VALID_HIGHWAYS.has(key)) {
      throw new Error(`Unknown highway class "${key}" in free-flow factors`);
    }
    const factor = Number(val);
    if (!(factor > 0 && factor <= 1)) {
      throw new Error(`Free-flow factor for "${key}" must be in (0, 1], got "${val}"`);
    }
    factors[key as HighwayType] = factor;
  }
  return factors;
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

/**
 * Max distance (km) from a control Point feature (signal, stop, crossing, ...)
 * to the graph node it is attached to when its coordinate does not match a
 * node exactly. Farther points (typically on a road filtered out of the
 * graph) are dropped instead of charging a delay at an unrelated node. Shared
 * by `GraphBuilder` and the pathfinding worker so both attach the same set.
 */
export const MAX_CONTROL_SNAP_KM = 0.02;

/**
 * Parses an OSM Point feature's tags into zero or more {@link NodeControl}
 * descriptors. A single point can carry more than one (a compound
 * `highway=traffic_signals;crossing` value, or a railway level crossing that
 * is also tagged `highway=crossing`); the caller merges these — and any others
 * that snap to the same graph node — with {@link mergeNodeControl}.
 *
 * `traffic_calming=no` is explicit "no calming feature here" and is skipped,
 * matching the OSM convention for that value.
 */
export function parseNodeControls(props: Record<string, unknown>): NodeControl[] {
  const controls: NodeControl[] = [];
  const highwayValues = String(props.highway ?? "")
    .split(";")
    .map((v) => v.trim())
    .filter(Boolean);

  if (highwayValues.includes("traffic_signals")) {
    const rawDirection = props["traffic_signals:direction"];
    const direction =
      rawDirection === "forward" || rawDirection === "backward" ? rawDirection : "both";
    controls.push({ kind: "traffic_signals", direction });
  }
  if (highwayValues.includes("stop")) controls.push({ kind: "stop" });
  if (highwayValues.includes("give_way")) controls.push({ kind: "give_way" });
  if (highwayValues.includes("crossing")) {
    const crossing = props.crossing;
    controls.push({ kind: "crossing", subtype: crossing ? String(crossing) : undefined });
  }
  if (props.railway === "level_crossing") controls.push({ kind: "level_crossing" });

  const calming = props.traffic_calming;
  if (calming && calming !== "no") {
    controls.push({ kind: "traffic_calming", subtype: String(calming) });
  }

  return controls;
}
