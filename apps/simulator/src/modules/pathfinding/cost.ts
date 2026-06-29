/**
 * Shared A* edge-cost helpers used by BOTH the main-thread {@link RoadNetwork}
 * and the {@link "../../workers/pathfinding-worker"} so the two implementations
 * cannot drift apart (they were previously hand-synced and easy to desync).
 *
 * The per-edge travel-time cost splits into two parts:
 *
 *  - A STATIC base cost — surface penalty, smoothness penalty and BPR congestion
 *    (which uses the outbound-edge count of the edge's start node as a flow
 *    proxy). None of these change at runtime, so they are precomputed ONCE at
 *    graph-build time via {@link computeBaseTravelTime} and stored on the edge.
 *
 *  - DYNAMIC terms applied during the A* relaxation loop: the incident speed
 *    factor and the traffic-signal delay at the destination node. These are
 *    cheap and depend on per-request / per-tick state, so they stay in the loop
 *    (see {@link applyDynamicCost}).
 *
 * Splitting the static part out of the hot relaxation loop avoids recomputing
 * the same penalties millions of times per route search.
 */

/** Seconds of delay added when traversing into a signalized node (midpoint of a 30–90s cycle). */
const SIGNAL_DELAY_S = 45;
/** Signal delay expressed in hours (travel-time costs are in hours). */
export const SIGNAL_DELAY_H = SIGNAL_DELAY_S / 3600;

/** Minimal static shape an edge must expose to compute its base travel time. */
export interface EdgeStatics {
  distance: number;
  maxSpeed: number;
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
  return (edge.distance / edge.maxSpeed) * surfacePenalty * smoothnessPenalty * bprCongestion;
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
 * @param endHasSignal    Whether the edge's destination node is signalized.
 * @returns Adjusted travel time in hours.
 */
export function applyDynamicCost(
  baseTravelTime: number,
  incidentFactor: number | undefined,
  endHasSignal: boolean
): number {
  let travelTime = baseTravelTime;
  if (incidentFactor !== undefined && incidentFactor < 1) {
    travelTime = travelTime / incidentFactor;
  }
  if (endHasSignal) {
    travelTime += SIGNAL_DELAY_H;
  }
  return travelTime;
}
