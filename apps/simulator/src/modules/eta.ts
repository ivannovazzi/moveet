import type { Edge, EtaBreakdown } from "../types";

/**
 * Route ETA pricing — the one place a route is turned into seconds.
 *
 * **Why this is not `distance / vehicle.speed`.** That was the old
 * `estimateRouteDuration`, and it priced the WHOLE remaining route at the
 * vehicle's *instantaneous* speed. A vehicle easing through a turn at 8 km/h
 * on one 40-metre edge had every kilometre still ahead of it priced at 8 km/h,
 * so the broadcast ETA moved by the same ratio as the speedometer. The ETA was
 * a reciprocal of current speed with extra steps, and none of the inputs this
 * epic added (learned speeds, typed node delays, turn penalties, weather)
 * reached it.
 *
 * Pricing here is a property of the ROUTE and the network's current state, not
 * of how fast the vehicle happens to be going this tick. Each edge is priced at
 * the speed the movement model will cap it at, so small speed excursions move
 * the ETA only by the time they actually cost on the edge they happen on.
 *
 * The terms match `RouteManager.estimateTo`'s contract exactly, because that
 * function now calls this one:
 *
 *  - **Edge speed** — the learned profile speed if the edge has one, else its
 *    free-flow speed, else the posted limit; capped by the vehicle profile's
 *    top speed, then scaled by the global weather factor. Scaling speed by the
 *    factor is equivalent to the routing cost's dividing travel time by it.
 *  - **Node delay** — the edge's precomputed `nodeDelayH` (signal / stop /
 *    give-way / crossing / level crossing / traffic calming at its end node),
 *    additive and deliberately NOT weather-scaled: a red light's expected wait
 *    doesn't grow in the rain the way a moving edge's travel time does.
 *  - **Turn cost** — the manoeuvre cost of turning ONTO this edge from the
 *    previous one, priced by the same `pathfinding/turns.ts` model the search
 *    charges, including the first turn off the vehicle's current edge.
 *
 * It deliberately leaves out the terms the route SEARCH uses only to choose
 * between routes and that `updateSpeed` never applies to movement — the static
 * surface/smoothness/BPR penalties in the base cost, and incident speed
 * factors. Including them would make ETAs disagree with simulated arrival.
 */

/** Minimum speed (km/h) an edge may be priced at, so a pathological input can't divide by ~0. */
const MIN_PRICED_SPEED_KMH = 1;

/**
 * The network- and vehicle-side inputs pricing needs. An interface rather than
 * a `RoadNetwork` so the pricing is testable without a graph, and so the worker
 * side could reuse it without importing the whole network module.
 */
export interface EtaPricingInputs {
  /** Learned per-edge speed (km/h) from the active speed profile, if any. */
  learnedSpeedKmh(edge: Edge): number | undefined;
  /** Manoeuvre cost in hours for turning from `from` onto `to`. */
  turnCostHours(from: Edge, to: Edge): number;
  /** Global weather speed multiplier in (0, 1]. */
  weatherFactor: number;
  /** The vehicle profile's top speed (km/h) — the movement model's cap. */
  profileMaxSpeed: number;
}

/** A priced route: per-edge seconds plus the suffix sums that make a live ETA O(1). */
export interface RoutePricing {
  /**
   * Seconds for each route edge: its traversal time, its end-node delay, and
   * the turn onto it. Indexed like `route.edges`.
   */
  perEdgeSeconds: number[];
  /**
   * Of {@link perEdgeSeconds}, the part that accrues linearly along the edge
   * (traversal only — no node delay, no turn cost). Kept separately so a
   * part-driven edge can be discounted correctly; see
   * {@link remainingEtaSeconds}.
   */
  perEdgeDrivingSeconds: number[];
  /**
   * `suffixSeconds[i]` = seconds from the START of edge `i` to the end of the
   * route. Length is `edges.length + 1`; the last entry is 0. Lets a tick read
   * the remaining ETA with one array lookup instead of re-walking the route.
   */
  suffixSeconds: number[];
  /** Total route time in seconds — `suffixSeconds[0]`. */
  totalSeconds: number;
  /** Distance of each route edge (km), so a remaining-distance readout is free. */
  perEdgeKm: number[];
  /** `suffixKm[i]` = km from the start of edge `i` to the end of the route. */
  suffixKm: number[];
  breakdown: EtaBreakdown;
  /**
   * The weather factor pricing was computed at. Callers cache a `RoutePricing`
   * per vehicle and reprice when the live factor no longer matches this.
   */
  pricedAtWeatherFactor: number;
}

/** An empty pricing, for a vehicle with no route. Shared, so it allocates nothing. */
const EMPTY_PRICING: RoutePricing = Object.freeze({
  perEdgeSeconds: [],
  perEdgeDrivingSeconds: [],
  suffixSeconds: [0],
  totalSeconds: 0,
  perEdgeKm: [],
  suffixKm: [0],
  breakdown: Object.freeze({
    drivingSeconds: 0,
    nodeDelaySeconds: 0,
    turnSeconds: 0,
    weatherFactor: 1,
    learnedDistanceShare: 0,
  }),
  pricedAtWeatherFactor: 1,
}) as RoutePricing;

/**
 * Prices a route edge by edge.
 *
 * @param edges - the route's edges, in order.
 * @param inputs - network state and the vehicle profile's speed cap.
 * @param arrivalEdge - the edge the vehicle arrives on, when the route starts
 *   at the end of an edge it is already driving. Charges the first turn, the
 *   same way the search does when it is given an arrival edge.
 */
export function priceRoute(
  edges: Edge[],
  inputs: EtaPricingInputs,
  arrivalEdge?: Edge
): RoutePricing {
  if (edges.length === 0) return EMPTY_PRICING;

  const weatherFactor = inputs.weatherFactor;
  const perEdgeSeconds = new Array<number>(edges.length);
  const perEdgeDrivingSeconds = new Array<number>(edges.length);
  const perEdgeKm = new Array<number>(edges.length);
  let drivingSeconds = 0;
  let nodeDelaySeconds = 0;
  let turnSeconds = 0;
  let learnedKm = 0;
  let totalKm = 0;

  let previous: Edge | undefined = arrivalEdge;
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const learned = inputs.learnedSpeedKmh(edge);
    const baseSpeed = learned ?? edge.freeFlowSpeed ?? edge.maxSpeed;
    const speed = Math.max(
      Math.min(inputs.profileMaxSpeed, baseSpeed) * weatherFactor,
      MIN_PRICED_SPEED_KMH
    );

    const driving = (edge.distance / speed) * 3600;
    const nodeDelay = (edge.nodeDelayH ?? 0) * 3600;
    const turn = previous ? inputs.turnCostHours(previous, edge) * 3600 : 0;

    perEdgeSeconds[i] = driving + nodeDelay + turn;
    perEdgeDrivingSeconds[i] = driving;
    perEdgeKm[i] = edge.distance;
    drivingSeconds += driving;
    nodeDelaySeconds += nodeDelay;
    turnSeconds += turn;
    totalKm += edge.distance;
    if (learned !== undefined) learnedKm += edge.distance;

    previous = edge;
  }

  // Suffix sums, built back to front so index i is "everything from edge i on".
  const suffixSeconds = new Array<number>(edges.length + 1);
  const suffixKm = new Array<number>(edges.length + 1);
  suffixSeconds[edges.length] = 0;
  suffixKm[edges.length] = 0;
  for (let i = edges.length - 1; i >= 0; i--) {
    suffixSeconds[i] = suffixSeconds[i + 1] + perEdgeSeconds[i];
    suffixKm[i] = suffixKm[i + 1] + perEdgeKm[i];
  }

  return {
    perEdgeSeconds,
    perEdgeDrivingSeconds,
    suffixSeconds,
    totalSeconds: suffixSeconds[0],
    perEdgeKm,
    suffixKm,
    breakdown: {
      drivingSeconds,
      nodeDelaySeconds,
      turnSeconds,
      weatherFactor,
      learnedDistanceShare: totalKm > 0 ? learnedKm / totalKm : 0,
    },
    pricedAtWeatherFactor: weatherFactor,
  };
}

/**
 * Seconds left from a vehicle's current place on its route.
 *
 * `edgeIndex` indexes `route.edges`; `progress` is the fraction [0, 1] already
 * covered on that edge. The part of the current edge already driven is
 * discounted from its DRIVING time only — the node delay and turn cost folded
 * into `perEdgeSeconds[edgeIndex]` are events at the edge's ends, not things
 * that accrue linearly along it. Pro-rating the whole per-edge figure would
 * make a vehicle appear to work off a red light it hasn't reached yet.
 *
 * Returns `undefined` when the vehicle isn't on a priced edge (no route, or it
 * hasn't been placed on the route yet) — a gap, never a fabricated number.
 */
export function remainingEtaSeconds(
  pricing: RoutePricing,
  edgeIndex: number,
  progress: number
): number | undefined {
  if (edgeIndex < 0 || edgeIndex >= pricing.perEdgeSeconds.length) return undefined;
  const clamped = Math.min(Math.max(progress, 0), 1);
  const covered = pricing.perEdgeDrivingSeconds[edgeIndex] * clamped;
  return Math.max(pricing.suffixSeconds[edgeIndex] - covered, 0);
}

/** Kilometres left from a vehicle's current place on its route. See {@link remainingEtaSeconds}. */
export function remainingDistanceKm(
  pricing: RoutePricing,
  edgeIndex: number,
  progress: number
): number | undefined {
  if (edgeIndex < 0 || edgeIndex >= pricing.perEdgeKm.length) return undefined;
  const clamped = Math.min(Math.max(progress, 0), 1);
  return Math.max(pricing.suffixKm[edgeIndex] - pricing.perEdgeKm[edgeIndex] * clamped, 0);
}

export { EMPTY_PRICING };
export type { EtaBreakdown };
