/**
 * Shared A* edge-cost helpers used by BOTH the main-thread {@link RoadNetwork}
 * and the {@link "../../workers/pathfinding-worker"} so the two implementations
 * cannot drift apart (they were previously hand-synced and easy to desync).
 *
 * Travel time is priced at the edge's free-flow speed (posted limit × the
 * highway class's free-flow factor, see `roadnetwork/types.ts`), which is also
 * what `RouteManager` caps vehicle movement at, so route ETAs match simulated
 * driving. The per-edge travel-time cost splits into two parts:
 *
 *  - A STATIC base cost — surface penalty, smoothness penalty and BPR congestion
 *    (which uses the outbound-edge count of the edge's start node as a flow
 *    proxy). None of these change at runtime, so they are precomputed ONCE at
 *    graph-build time via {@link computeBaseTravelTime} and stored on the edge.
 *
 *  - DYNAMIC terms applied during the A* relaxation loop: the incident speed
 *    factor and the node-control delay (traffic signal / stop / give-way /
 *    crossing / level crossing / traffic calming) at the destination node.
 *    The node-control delay itself is precomputed per edge at graph-build time
 *    (see {@link nodeDelayHours}, called from `GraphBuilder`/the worker's
 *    `buildGraph`) — it stays out of `computeBaseTravelTime`/the ALT landmark
 *    tables only because those are read from a plain edge-cost map, and this is
 *    cheaper to fold in alongside the incident term in the loop that already
 *    reads that map (see {@link applyDynamicCost}).
 *
 * Splitting the static part out of the hot relaxation loop avoids recomputing
 * the same penalties millions of times per route search.
 */

// ─── Node control delays ───────────────────────────────────────────────
//
// Every OSM point feature that makes a vehicle slow down or stop is reduced,
// at graph-build time, to a `NodeControl` describing what kind of control it
// is and — for the two kinds where it matters — a road-class-dependent or
// tag-dependent modifier. `nodeDelayHours` turns that into an expected-value
// delay in hours, which `GraphBuilder`/the worker precompute PER EDGE (the
// delay for a signal/stop/etc. can depend on which road you approach it on,
// e.g. a major-road approach at a signalized intersection gets more green
// time than a minor-road approach) and store on the edge, so the A* loop only
// ever adds a plain non-negative number — never re-derives it from tags.

import type { HighwayType } from "../../types";

export type NodeControlKind =
  | "traffic_signals"
  | "stop"
  | "give_way"
  | "crossing"
  | "level_crossing"
  | "traffic_calming";

export interface NodeControl {
  kind: NodeControlKind;
  /**
   * For `crossing`: the OSM `crossing=*` value (`traffic_signals`, `marked`,
   * `uncontrolled`, `zebra`, `unmarked`, ...). For `traffic_calming`: the
   * `traffic_calming=*` value (`bump`, `hump`, `table`, ...). Unused otherwise.
   */
  subtype?: string;
  /**
   * OSM `traffic_signals:direction` (`forward` | `backward` | `both`).
   * `traffic_signals` only; defaults to `"both"` when absent.
   */
  direction?: "forward" | "backward" | "both";
}

/** Road classes that get the longer green split at a signalized intersection. */
const MAJOR_HIGHWAYS = new Set<HighwayType>(["motorway", "trunk", "primary", "secondary"]);

// Expected-value seconds of delay per control kind, i.e. the AVERAGE wait
// across many arrivals — not the worst case. A green-on-arrival vehicle waits
// 0s; these numbers are what that averages out to given typical cycle lengths
// / stop compliance / crossing activation rates. Replaces the old flat 45s
// SIGNAL_DELAY_S, which overestimated every arrival as a full mid-cycle wait.
/** Signalized intersection, approach is a major road (longer green split). */
const SIGNAL_DELAY_MAJOR_S = 15;
/** Signalized intersection, approach is a minor road (shorter green split). */
const SIGNAL_DELAY_MINOR_S = 25;
/** Mandatory full stop: always incurred, regardless of approach class. */
const STOP_DELAY_S = 5;
/** Yield: usually no one is coming, so most arrivals barely slow down. */
const GIVE_WAY_DELAY_S = 2;
/** Pedestrian-signal crossing: usually green for traffic unless button-pressed. */
const CROSSING_SIGNAL_DELAY_S = 8;
/** Marked/zebra/uncontrolled crossing: driver must slow and check/yield. */
const CROSSING_MARKED_DELAY_S = 3;
/** Unmarked/informal crossing: minimal expected effect. */
const CROSSING_UNMARKED_DELAY_S = 1;
/**
 * Railway level crossing: gates are up the vast majority of the time. Expected
 * value ~= P(a train is due) x mean wait when blocked, plus a small
 * always-incurred slow-to-look overhead.
 */
const LEVEL_CROSSING_DELAY_S = 6;
/** Per-subtype traffic-calming point delay (deceleration over the feature). */
const TRAFFIC_CALMING_DELAY_S: Readonly<Record<string, number>> = Object.freeze({
  table: 3,
  chicane: 3,
  choker: 3,
  island: 2,
  bump: 2,
  hump: 2,
  cushion: 2,
  rumble_strip: 1,
});
const DEFAULT_TRAFFIC_CALMING_DELAY_S = 2;

/**
 * Maximum through speed (km/h) on an edge whose WAY itself carries
 * `traffic_calming=*` (as opposed to a point feature snapped to one of its
 * endpoints — see {@link parseNodeControls}). Caps `freeFlowSpeed` instead of
 * adding a delay, since the feature runs the length of the edge rather than
 * sitting at a single point.
 */
export const TRAFFIC_CALMING_MAX_SPEED_KMH = 25;

/**
 * Priority order used to resolve a node where more than one control tag
 * landed (a compound `highway=traffic_signals;crossing` value, or two OSM
 * points snapping to the same graph node). Higher wins.
 */
const CONTROL_PRIORITY: Record<NodeControlKind, number> = {
  level_crossing: 6,
  traffic_signals: 5,
  stop: 4,
  crossing: 3,
  give_way: 2,
  traffic_calming: 1,
};

/** Keeps whichever of two controls at the same node has higher priority. */
export function mergeNodeControl(
  existing: NodeControl | undefined,
  incoming: NodeControl
): NodeControl {
  if (!existing) return incoming;
  return CONTROL_PRIORITY[incoming.kind] > CONTROL_PRIORITY[existing.kind] ? incoming : existing;
}

/**
 * Expected-value delay (seconds) for arriving at a node with `control` via an
 * edge of class `approachHighway`.
 */
export function computeNodeDelayS(control: NodeControl, approachHighway: HighwayType): number {
  switch (control.kind) {
    case "traffic_signals": {
      const base = MAJOR_HIGHWAYS.has(approachHighway)
        ? SIGNAL_DELAY_MAJOR_S
        : SIGNAL_DELAY_MINOR_S;
      // A one-directional signal (traffic_signals:direction=forward|backward)
      // only controls one approach. Point features are matched to graph nodes
      // by nearest coordinate (no way-order linkage), so we cannot attribute
      // it to the correct edge — halve the expected delay on both directions
      // instead of over- or under-charging either one.
      return control.direction && control.direction !== "both" ? base / 2 : base;
    }
    case "stop":
      return STOP_DELAY_S;
    case "give_way":
      return GIVE_WAY_DELAY_S;
    case "crossing":
      if (control.subtype === "traffic_signals") return CROSSING_SIGNAL_DELAY_S;
      if (control.subtype === "unmarked") return CROSSING_UNMARKED_DELAY_S;
      // marked / uncontrolled / zebra / unspecified: legal priority to pedestrians
      return CROSSING_MARKED_DELAY_S;
    case "level_crossing":
      return LEVEL_CROSSING_DELAY_S;
    case "traffic_calming":
      return control.subtype
        ? (TRAFFIC_CALMING_DELAY_S[control.subtype] ?? DEFAULT_TRAFFIC_CALMING_DELAY_S)
        : DEFAULT_TRAFFIC_CALMING_DELAY_S;
    default:
      return 0;
  }
}

/** {@link computeNodeDelayS}, converted to hours (travel-time costs are in hours). */
export function nodeDelayHours(
  control: NodeControl | undefined,
  approachHighway: HighwayType
): number {
  if (!control) return 0;
  return computeNodeDelayS(control, approachHighway) / 3600;
}

/** Minimal static shape an edge must expose to compute its base travel time. */
export interface EdgeStatics {
  distance: number;
  maxSpeed: number;
  /** Free-flow travel speed (km/h); the cost is priced at this when present. */
  freeFlowSpeed?: number;
  surface: string;
  /** lanes × 1800 veh/hour (HCM). Falls back to 1800 when absent. */
  capacity?: number;
  /** 0.3–1.0 multiplier from the OSM smoothness tag; 0 = impassable. */
  smoothnessFactor?: number;
}

/**
 * Computes the static (time-invariant) base travel time for an edge.
 *
 * @param edge   Static edge properties.
 * @param flow   Outbound-edge count of the edge's START node (BPR flow proxy).
 *               In the main thread this is `edge.start.connections.length`; in
 *               the worker it is the start node's `edges.length` — they are the
 *               same quantity.
 * @returns Base travel time in hours, BEFORE incident/signal adjustments.
 */
export function computeBaseTravelTime(edge: EdgeStatics, flow: number): number {
  const surfacePenalty = edge.surface === "unpaved" || edge.surface === "dirt" ? 1.3 : 1.0;
  // avoid div-by-zero for impassable=0 (callers skip impassable edges anyway)
  const smoothnessPenalty = 1 / ((edge.smoothnessFactor ?? 1.0) || 1.0);
  const bprRatio = flow / (edge.capacity ?? 1800);
  const bprRatio2 = bprRatio * bprRatio;
  const bprCongestion = 1 + 0.15 * (bprRatio2 * bprRatio2);
  const speed = edge.freeFlowSpeed ?? edge.maxSpeed;
  return (edge.distance / speed) * surfacePenalty * smoothnessPenalty * bprCongestion;
}

/**
 * Applies the dynamic (per-request / per-tick) cost terms on top of an edge's
 * precomputed static base travel time during A* relaxation.
 *
 * @param baseTravelTime  Static base cost from {@link computeBaseTravelTime}.
 * @param incidentFactor  Incident speed factor for this edge, or undefined when
 *                        no incident applies. 0 means a closure (callers skip
 *                        the edge before reaching here). A value < 1 slows the
 *                        edge proportionally.
 * @param nodeDelayH      Precomputed, non-negative expected delay (hours) for
 *                        arriving at the edge's destination node — from
 *                        {@link nodeDelayHours} via the edge's `nodeDelayH`
 *                        field, or `0` when the node has no control. Always
 *                        additive, so it can never make the ALT landmark bound
 *                        (built on the static base cost alone) overestimate.
 * @returns Adjusted travel time in hours.
 */
export function applyDynamicCost(
  baseTravelTime: number,
  incidentFactor: number | undefined,
  nodeDelayH: number
): number {
  let travelTime = baseTravelTime;
  if (incidentFactor !== undefined && incidentFactor < 1) {
    travelTime = travelTime / incidentFactor;
  }
  if (nodeDelayH > 0) {
    travelTime += nodeDelayH;
  }
  return travelTime;
}
