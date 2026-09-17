/**
 * Shared turn model used by BOTH the main-thread `PathfindingEngine` and the
 * `workers/pathfinding-worker` A* (and by `RouteManager.estimateTo`), so the
 * two searches cannot disagree on what a turn costs or which turns are legal.
 *
 * Two parts:
 *
 *  - TURN PENALTIES: an expected-value time cost for the manoeuvre at a node,
 *    from the angle between the arriving and leaving edge, the drive side
 *    (`DRIVE_SIDE`), and whether the turn crosses oncoming traffic. Always
 *    >= 0 and applied during relaxation on top of the edge cost, never folded
 *    into the static base costs the ALT landmark tables are built from — so
 *    the landmark bound (a lower bound on base cost alone) stays admissible.
 *
 *  - TURN RESTRICTIONS: OSM `type=restriction` relations (from-way / via-node /
 *    to-way), resolved at graph-build time into `inEdgeId -> Set<outEdgeId>`
 *    bans. Via-WAY restrictions are not supported (the network CLI drops them),
 *    nor are time-conditional ones (`restriction:conditional`).
 *
 * Both need the incoming edge in the search state, which is why the A* on both
 * sides is edge-based (a state is "arrived at a node via this edge").
 */

export type DriveSide = "left" | "right";

export const DEFAULT_DRIVE_SIDE: DriveSide = "right";

/**
 * Initial great-circle bearing in degrees [0, 360) from `start` to `end`
 * (`[lat, lon]`). The single implementation behind `utils/helpers`'
 * `calculateBearing` and the worker's edge bearings, so turn angles are
 * bit-identical on both sides.
 */
export function bearingDegrees(start: [number, number], end: [number, number]): number {
  const [lat1, lon1] = start.map((x) => (x * Math.PI) / 180);
  const [lat2, lon2] = end.map((x) => (x * Math.PI) / 180);

  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Signed turn angle in degrees, in (-180, 180]: positive turns right
 * (clockwise), negative turns left.
 */
export function turnAngle(inBearing: number, outBearing: number): number {
  let delta = (outBearing - inBearing) % 360;
  if (delta > 180) delta -= 360;
  else if (delta <= -180) delta += 360;
  return delta;
}

// ─── Turn penalties ────────────────────────────────────────────────────
//
// Expected seconds lost to the manoeuvre itself (braking into the turn,
// yielding, gap acceptance) — not the wait at a traffic control, which the
// per-edge `nodeDelayH` already prices (see cost.ts). Kept deliberately modest.

/**
 * Turns at or below this angle are "straight on / slight bend" and free. Equal
 * to the movement model's default `TURN_THRESHOLD` (30°), below which
 * `RouteManager.updateSpeed` does not slow for the turn either.
 */
const STRAIGHT_MAX_DEG = 30;
/** Geometric slowdown for a turn just past the straight threshold. */
const TURN_BASE_S = 2;
/** Additional geometric slowdown scaled up to a 150°+ hairpin. */
const TURN_SHARPNESS_S = 4;
/**
 * Extra for a far-side turn (left in right-hand traffic) across oncoming
 * traffic at an unsignalized intersection: waiting for a gap.
 */
const CROSS_ONCOMING_S = 6;
/**
 * The same extra at a signalized intersection. The signal's own expected wait
 * is already in `nodeDelayH`, and the phase resolves most of the conflict, so
 * only the permissive-phase gap acceptance is left — about half.
 */
const CROSS_ONCOMING_SIGNALIZED_S = 3;
/** Reversing onto the edge just travelled (stop, swing wide / three-point turn). */
const U_TURN_S = 25;

/** Per-node facts the turn penalty needs; precomputed at graph build. */
export interface TurnNodeContext {
  /** Distinct neighbouring nodes (in or out). 1 = dead end, 2 = bend, >= 3 = intersection. */
  degree: number;
  /** Whether the node carries a traffic signal. */
  signalized: boolean;
}

/**
 * U-turns are allowed at dead ends (the only way out) and at intersections
 * (where OSM maps `no_u_turn` explicitly when they are illegal), but not at a
 * mid-block vertex of a single road — unless the U-turn is the node's only
 * outgoing edge (e.g. a two-way road meeting an inbound-only one-way), where
 * banning it would trap every arrival.
 *
 * @param degree     Distinct neighbouring nodes (in or out), see {@link TurnNodeContext}.
 * @param outDegree  Outgoing edges of the node; omitted = unknown (no exception).
 */
export function isUTurnAllowed(degree: number, outDegree?: number): boolean {
  return degree !== 2 || outDegree === 1;
}

/**
 * Expected time (seconds) for turning from an edge with bearing `inBearing`
 * onto one with `outBearing` at a node described by `node`.
 *
 * @param isUTurn   The leaving edge returns to the arriving edge's start node.
 * @param inTwoWay  The arriving edge's road carries oncoming traffic.
 */
export function turnPenaltySeconds(
  inBearing: number,
  outBearing: number,
  isUTurn: boolean,
  inTwoWay: boolean,
  node: TurnNodeContext,
  driveSide: DriveSide
): number {
  if (isUTurn) return U_TURN_S;
  const angle = turnAngle(inBearing, outBearing);
  const magnitude = angle < 0 ? -angle : angle;
  if (magnitude <= STRAIGHT_MAX_DEG) return 0;

  const sharpness = Math.min(1, (magnitude - STRAIGHT_MAX_DEG) / 120);
  let seconds = TURN_BASE_S + TURN_SHARPNESS_S * sharpness;

  // Far side = against the drive side: left in right-hand traffic.
  const farSide = driveSide === "right" ? angle < 0 : angle > 0;
  if (farSide && inTwoWay && node.degree >= 3) {
    seconds += node.signalized ? CROSS_ONCOMING_SIGNALIZED_S : CROSS_ONCOMING_S;
  }
  return seconds;
}

/** {@link turnPenaltySeconds} in hours (travel-time costs are in hours). */
export function turnCostHours(
  inBearing: number,
  outBearing: number,
  isUTurn: boolean,
  inTwoWay: boolean,
  node: TurnNodeContext,
  driveSide: DriveSide
): number {
  return turnPenaltySeconds(inBearing, outBearing, isUTurn, inTwoWay, node, driveSide) / 3600;
}

// ─── Turn restrictions ─────────────────────────────────────────────────

/** A parsed from-way / via-node / to-way restriction. */
export interface TurnRestriction {
  /** `no_*` bans the from→to turn; `only_*` bans every other exit from `from`. */
  kind: "no" | "only";
  /** Street id (OSM way id) of the approach. */
  from: string;
  /** Graph node id of the via node. */
  via: string;
  /** Street id (OSM way id) of the exit. */
  to: string;
  /** The value is a `*_u_turn` restriction (`no_u_turn` / `only_u_turn`). */
  uTurn?: boolean;
}

/** Vehicle-class keys that bind a car, most specific first. */
const RESTRICTION_KEYS = [
  "restriction:motorcar",
  "restriction:motor_vehicle",
  "restriction:vehicle",
  "restriction",
] as const;
/** `except=*` values that exempt a car from a generic `restriction`. */
const CAR_EXEMPTIONS = new Set(["motorcar", "motor_vehicle", "vehicle"]);

/**
 * Parses a restriction feature into a {@link TurnRestriction}, or `null` when
 * it is not one, does not bind cars, or is incomplete.
 *
 * Two shapes are accepted:
 *  - the network CLI's: a Point at the via node, numeric `from`/`to` way ids;
 *  - the legacy hand-written one: no geometry, `via` as a `"lat,lon"` string
 *    (or `via:node`, `from:way`, `to:way`).
 *
 * @param makeNodeKey  The builder's coordinate snapping, so `via` matches a graph node id.
 */
export function parseTurnRestriction(
  props: Record<string, unknown>,
  geometry: { type: string; coordinates?: unknown } | null | undefined,
  makeNodeKey: (lat: number, lon: number) => string
): TurnRestriction | null {
  if (props.type !== "restriction" && props["@type"] !== "restriction") return null;

  let value: string | undefined;
  let key: (typeof RESTRICTION_KEYS)[number] | undefined;
  for (const k of RESTRICTION_KEYS) {
    if (props[k] !== undefined && props[k] !== null && props[k] !== "") {
      value = String(props[k]);
      key = k;
      break;
    }
  }
  if (!value) return null;
  const kind = value.startsWith("no_") ? "no" : value.startsWith("only_") ? "only" : null;
  if (!kind) return null;

  // `except` qualifies the generic tag only; a class-specific key already
  // names who it binds.
  if (key === "restriction" && props.except !== undefined) {
    const exempt = String(props.except)
      .split(";")
      .map((v) => v.trim());
    if (exempt.some((v) => CAR_EXEMPTIONS.has(v))) return null;
  }

  const from = props.from ?? props["from:way"];
  const to = props.to ?? props["to:way"];
  if (from === undefined || from === null || from === "") return null;
  if (to === undefined || to === null || to === "") return null;

  let via: string | null = null;
  if (geometry?.type === "Point" && Array.isArray(geometry.coordinates)) {
    const [lon, lat] = geometry.coordinates as number[];
    via = makeNodeKey(lat, lon);
  } else {
    const raw = props.via ?? props["via:node"];
    if (raw !== undefined && raw !== null && raw !== "") {
      const parts = String(raw).split(",");
      via =
        parts.length === 2 && !isNaN(Number(parts[0])) && !isNaN(Number(parts[1]))
          ? makeNodeKey(Number(parts[0]), Number(parts[1]))
          : String(raw);
    }
  }
  if (!via) return null;

  const restriction: TurnRestriction = { kind, from: String(from), via, to: String(to) };
  if (value.endsWith("_u_turn")) restriction.uTurn = true;
  return restriction;
}

/** The minimal edge shape {@link resolveTurnBans} needs from either graph. */
export interface TurnGraphEdge {
  id: string;
  streetId: string;
  startNodeId: string;
  endNodeId: string;
}

/**
 * Resolves way-level restrictions into edge-level bans: `inEdgeId -> Set of
 * outEdgeIds` that may not follow it.
 *
 *  - `no_*`: bans each (approach edge on `from` into `via`) -> (exit edge on
 *    `to` out of `via`). When `from === to` (typically `no_u_turn`) only the
 *    exit back to the approach's start is banned, so a way that merely passes
 *    through the via node keeps its straight-on continuation. The same
 *    narrowing applies to a same-way `only_u_turn`, but NOT to other same-way
 *    `only_*` (e.g. `only_straight_on` along a through way), whose allowed
 *    exits are every edge of that way.
 *  - `only_*`: bans every exit that is not on an allowed `to` way. Several
 *    `only_*` on the same approach union their allowed exits. When no allowed
 *    exit exists in the graph (the to-way was filtered out) the restriction is
 *    dropped rather than turning the approach into a dead end.
 *
 * Restrictions whose via node, from-way or to-way is not in the graph are
 * ignored.
 */
export function resolveTurnBans(
  restrictions: readonly TurnRestriction[],
  incoming: (nodeId: string) => readonly TurnGraphEdge[],
  outgoing: (nodeId: string) => readonly TurnGraphEdge[]
): Map<string, Set<string>> {
  const bans = new Map<string, Set<string>>();
  const ban = (inId: string, outId: string) => {
    let set = bans.get(inId);
    if (!set) {
      set = new Set();
      bans.set(inId, set);
    }
    set.add(outId);
  };

  // Allowed exits per approach edge, accumulated across only_* restrictions.
  const mandatory = new Map<string, { exits: readonly TurnGraphEdge[]; allowed: Set<string> }>();

  for (const r of restrictions) {
    // Same-way restriction that is about reversing: only the U-turn is meant.
    const sameWayUTurn = r.from === r.to && (r.kind === "no" || r.uTurn === true);
    const approaches = incoming(r.via).filter((e) => e.streetId === r.from);
    if (approaches.length === 0) continue;
    const exits = outgoing(r.via);

    for (const approach of approaches) {
      const targets = exits.filter(
        (e) => e.streetId === r.to && (!sameWayUTurn || e.endNodeId === approach.startNodeId)
      );
      if (r.kind === "no") {
        for (const t of targets) ban(approach.id, t.id);
      } else if (targets.length > 0) {
        let entry = mandatory.get(approach.id);
        if (!entry) {
          entry = { exits, allowed: new Set() };
          mandatory.set(approach.id, entry);
        }
        for (const t of targets) entry.allowed.add(t.id);
      }
    }
  }

  for (const [inId, { exits, allowed }] of mandatory) {
    for (const exit of exits) {
      if (!allowed.has(exit.id)) ban(inId, exit.id);
    }
  }

  return bans;
}
