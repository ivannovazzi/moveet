import type { Edge, Position, Route } from "@/types";

/**
 * Turn-by-turn derivation for the vehicle inspector.
 *
 * The simulator already ships everything we need on `route.edges`: each edge
 * carries its road `name`, its compass `bearing`, and its `distance` (km). This
 * module folds that per-edge stream into Google-Maps-style *steps* — one per
 * contiguous run of edges on the same road — and classifies the maneuver at
 * each step boundary from the bearing delta between the two roads. No extra
 * network round-trip; it's a pure transform over data the UI already holds.
 */

export type Maneuver =
  | "depart"
  | "straight"
  | "slight-left"
  | "left"
  | "sharp-left"
  | "slight-right"
  | "right"
  | "sharp-right"
  | "uturn"
  | "arrive";

export interface DirectionStep {
  /** The maneuver to perform to *begin* this step. */
  maneuver: Maneuver;
  /** Road name for this step (or a synthetic label for unnamed ways). */
  road: string;
  /** Human-readable instruction, Google-Maps style. */
  instruction: string;
  /** Length of this step in km (sum of its edges). */
  distanceKm: number;
  /** Index of this step's first edge within `route.edges`. */
  edgeStart: number;
  /** One past this step's last edge within `route.edges` (exclusive). */
  edgeEnd: number;
}

const UNNAMED_ROAD = "Unnamed road";

const COMPASS_8 = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
] as const;

/** Bearing (deg, 0 = north, clockwise) → coarse 8-point compass word. */
export function bearingToCompass(bearing: number): string {
  const normalized = ((bearing % 360) + 360) % 360;
  return COMPASS_8[Math.round(normalized / 45) % 8];
}

/** Signed bearing delta in (-180, 180]; positive = turning right (clockwise). */
function bearingDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/**
 * Classify the maneuver between two consecutive road bearings. `right` is the
 * clockwise direction; thresholds mirror what a driver would call a slight vs.
 * full vs. sharp turn.
 */
export function classifyManeuver(fromBearing: number, toBearing: number): Maneuver {
  const delta = bearingDelta(fromBearing, toBearing);
  const magnitude = Math.abs(delta);
  if (magnitude <= 18) return "straight";
  if (magnitude >= 160) return "uturn";
  const right = delta > 0;
  if (magnitude <= 45) return right ? "slight-right" : "slight-left";
  if (magnitude <= 130) return right ? "right" : "left";
  return right ? "sharp-right" : "sharp-left";
}

function instructionFor(maneuver: Maneuver, road: string, compass?: string): string {
  switch (maneuver) {
    case "depart":
      return `Head ${compass ?? "out"} on ${road}`;
    case "straight":
      return `Continue onto ${road}`;
    case "slight-left":
      return `Slight left onto ${road}`;
    case "left":
      return `Turn left onto ${road}`;
    case "sharp-left":
      return `Sharp left onto ${road}`;
    case "slight-right":
      return `Slight right onto ${road}`;
    case "right":
      return `Turn right onto ${road}`;
    case "sharp-right":
      return `Sharp right onto ${road}`;
    case "uturn":
      return `Make a U-turn onto ${road}`;
    case "arrive":
      return "Arrive at your destination";
  }
}

/**
 * Group key that decides where one step ends and the next begins. Named roads
 * group by name (so a single road spanning several OSM ways stays one step);
 * unnamed edges fall back to their `streetId` so distinct unnamed ways — and
 * the turn between them — are still surfaced as separate steps.
 */
function groupKey(edge: Edge): string {
  const name = edge.name?.trim();
  return name ? `name:${name}` : `street:${edge.streetId}`;
}

function roadLabel(edge: Edge): string {
  return edge.name?.trim() || UNNAMED_ROAD;
}

/**
 * Fold a route's edges into ordered turn-by-turn steps. Returns an empty array
 * for a route with no edges. A terminal "arrive" step is appended so the list
 * always ends at the destination, mirroring turn-by-turn nav apps.
 */
export function buildDirectionSteps(edges: Edge[]): DirectionStep[] {
  if (edges.length === 0) return [];

  const steps: DirectionStep[] = [];
  let i = 0;
  while (i < edges.length) {
    const key = groupKey(edges[i]);
    let j = i;
    let distanceKm = 0;
    while (j < edges.length && groupKey(edges[j]) === key) {
      distanceKm += edges[j].distance;
      j++;
    }

    const first = edges[i];
    const road = roadLabel(first);
    let maneuver: Maneuver;
    let instruction: string;
    if (i === 0) {
      maneuver = "depart";
      instruction = instructionFor("depart", road, bearingToCompass(first.bearing));
    } else {
      maneuver = classifyManeuver(edges[i - 1].bearing, first.bearing);
      instruction = instructionFor(maneuver, road);
    }

    steps.push({
      maneuver,
      road,
      instruction,
      distanceKm,
      edgeStart: i,
      edgeEnd: j,
    });
    i = j;
  }

  const lastRoad = steps[steps.length - 1]?.road ?? UNNAMED_ROAD;
  steps.push({
    maneuver: "arrive",
    road: lastRoad,
    instruction: instructionFor("arrive", lastRoad),
    distanceKm: 0,
    edgeStart: edges.length,
    edgeEnd: edges.length,
  });

  return steps;
}

/** Squared planar distance between two [lat, lng] points (ranking only). */
function distanceSquared(a: Position, b: Position): number {
  const dLat = a[0] - b[0];
  const dLng = a[1] - b[1];
  return dLat * dLat + dLng * dLng;
}

/**
 * Index of the edge whose midpoint is closest to `position` ([lat, lng], the
 * same order edge coordinates use). Returns -1 when there are no edges. Used to
 * mark how far along the route the vehicle has progressed.
 */
export function findActiveEdgeIndex(edges: Edge[], position: Position | undefined): number {
  if (!position || edges.length === 0) return -1;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < edges.length; i++) {
    const start = edges[i].start.coordinates;
    const end = edges[i].end.coordinates;
    const mid: Position = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    const d = distanceSquared(mid, position);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Step index containing `edgeIndex`, or -1 if none does. */
export function stepIndexForEdge(steps: DirectionStep[], edgeIndex: number): number {
  if (edgeIndex < 0) return -1;
  return steps.findIndex((s) => edgeIndex >= s.edgeStart && edgeIndex < s.edgeEnd);
}

/** Sum of the distances of steps at or after `fromStep` (km). */
export function remainingDistanceKm(steps: DirectionStep[], fromStep: number): number {
  const start = fromStep < 0 ? 0 : fromStep;
  let total = 0;
  for (let i = start; i < steps.length; i++) total += steps[i].distanceKm;
  return total;
}

/** Total route distance (km). Prefers the route's own figure when present. */
export function totalDistanceKm(route: Route): number {
  if (typeof route.distance === "number" && route.distance > 0) return route.distance;
  return route.edges.reduce((sum, e) => sum + e.distance, 0);
}
