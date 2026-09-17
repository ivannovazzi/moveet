import type {
  Vehicle,
  Edge,
  Node,
  Route,
  Direction,
  DirectionResult,
  Waypoint,
  MultiStopRoute,
  Incident,
  StartOptions,
  VehicleEtaUpdate,
} from "../types";
import type { RoadNetwork } from "./RoadNetwork";
import type { VehicleRegistry } from "./VehicleRegistry";
import type { TrafficManager } from "./TrafficManager";
import { EventEmitter } from "events";
import * as utils from "../utils/helpers";
import { getProfile, FOLLOWING_DISTANCE_BY_SIZE } from "../utils/vehicleProfiles";
import { rng } from "../utils/rng";
import logger from "../utils/logger";
import { setUnroutedVehicles } from "../metrics";
import { config } from "../utils/config";
import { HEAT_ZONE_DEFAULTS } from "../constants";
import type { TraversalRecorder } from "./speedprofiles/TraversalRecorder";
import {
  priceRoute,
  remainingDistanceKm,
  remainingEtaSeconds,
  type EtaBreakdown,
  type RoutePricing,
} from "./eta";

/**
 * After the first "vehicle still unrouted" warning is logged for a vehicle,
 * repeat warnings are only logged every Nth retry so a vehicle stuck with no
 * reachable destination doesn't flood the logs. Mirrors GameLoop's
 * FAILURE_LOG_SAMPLE_RATE pattern.
 */
export const UNROUTED_LOG_SAMPLE_RATE = 100;

/**
 * Intensity that `options.heatZoneSpeedFactor` is defined AT — the "typical"
 * zone. A zone at exactly this intensity is slowed by exactly the configured
 * factor, which is what keeps intensity scaling from being a stealth global
 * speed change: only zones that are hotter/cooler than typical move.
 *
 * It is `HEAT_ZONE_DEFAULTS.DEFAULT_INTENSITY` (0.6) rather than a fresh
 * number, for two reasons: it is the intensity a zone gets when a caller
 * creates one without specifying (so it is literally "a zone, unqualified"),
 * and it sits near the middle of the generated range
 * (`MIN_INTENSITY` 0.3 … `MAX_INTENSITY` 1.0), so a seeded fleet's average
 * heat-zone penalty stays where it is today.
 */
export const HEAT_ZONE_NEUTRAL_INTENSITY = HEAT_ZONE_DEFAULTS.DEFAULT_INTENSITY;

/**
 * Maps a heat zone's current intensity onto a speed multiplier.
 *
 *   factor(i) = baseFactor ^ (clamp(i, 0, 1) / NEUTRAL)
 *
 * Properties this shape was chosen for:
 * - `i === NEUTRAL` reproduces `baseFactor` EXACTLY, so nothing changes for a
 *   typical zone (no stealth global slowdown).
 * - Monotonic: hotter zone → strictly lower factor. A 0.9 zone slows more than
 *   a 0.3 zone, which is the whole point of the issue.
 * - Intrinsically bounded in (0, 1] for any `baseFactor` in (0, 1], so an
 *   intensity above neutral can never drive the factor negative or to a hard
 *   zero. A linear `1 - penalty * i / NEUTRAL` mapping can, and a zero
 *   effective max speed is a deadlock: the vehicle stops, and a stopped
 *   vehicle can never leave the zone that stopped it.
 * - `i === 0` yields 1 (no penalty), the correct limit for a zone with no heat.
 *
 * @param baseFactor - `options.heatZoneSpeedFactor`, the configured penalty at neutral intensity.
 * @param intensity - The zone's current intensity, or null when unknown
 *        (legacy or injected zones with no intensity). Unknown deliberately
 *        returns `baseFactor` unchanged — today's behaviour — rather than
 *        guessing zero or maximum penalty.
 */
export function heatZoneSpeedFactorFor(baseFactor: number, intensity: number | null): number {
  if (intensity === null || !Number.isFinite(intensity)) return baseFactor;
  const clamped = Math.min(1, Math.max(0, intensity));
  return Math.min(1, baseFactor ** (clamped / HEAT_ZONE_NEUTRAL_INTENSITY));
}

/**
 * Manages route/waypoint tracking, pathfinding, and route-based movement.
 * Emits: 'direction', 'waypoint:reached', 'route:completed', 'vehicle:rerouted'
 */
export class RouteManager extends EventEmitter {
  private routes: Map<string, Route> = new Map();
  private waypointRoutes: Map<string, MultiStopRoute> = new Map();
  private lastPathfindAttempt: Map<string, number> = new Map();
  private static readonly PATHFIND_COOLDOWN = config.pathfindCooldownMs;
  /** Consecutive pathfind-retry count per vehicle, cleared once a route is set. */
  private unroutedAttempts: Map<string, number> = new Map();

  /**
   * Per-vehicle cache of the lean, serialized (non-circular) route. Built once
   * per route and reused across every `/vehicles` poll, `getStatus`, and event
   * emit so we don't re-serialize an unchanged route O(vehicles×routeLength)
   * times per request. Invalidated whenever the vehicle's route changes (see
   * {@link setRouteFor} / {@link deleteRoute}).
   */
  private serializedRouteCache: Map<string, Route> = new Map();

  /**
   * Per-vehicle route pricing (see `modules/eta.ts`), computed once at
   * {@link setRouteFor} and read by every ETA consumer: the `direction` event,
   * the per-tick live ETA on the wire, and `getDirections`.
   *
   * Cached rather than recomputed because a live ETA is read once per vehicle
   * per tick, and repricing a long route on every tick would be O(edges) work
   * in the hot path for a number that only changes when the route or the
   * network's state does. `arrivalEdge` is kept so a reprice (weather moved)
   * charges the same first turn the original pricing did.
   */
  private routePricing: Map<string, { pricing: RoutePricing; arrivalEdge?: Edge }> = new Map();

  // ─── Incident reroute staggering ──────────────────────────────────
  // A single incident can overlap every vehicle on an edge. Dispatching a
  // pathfind for all of them at once floods the bounded worker-pool queue and
  // starts getting rejected (reroutes then silently do not happen). Instead we
  // enqueue affected vehicles and drain in small batches spaced apart, which
  // spreads the load under the queue cap. The map debounces: a vehicle already
  // queued just has its target incident updated rather than enqueued twice.
  private rerouteQueue: Map<string, string> = new Map(); // vehicleId -> incidentId
  private rerouteDrainTimer: NodeJS.Timeout | null = null;
  private static readonly REROUTE_BATCH_SIZE = 20;
  private static readonly REROUTE_STAGGER_MS = 100;

  /**
   * Clock behind dwell deadlines (`vehicle.dwellUntil`) and the pathfind-retry
   * cooldown — the two pieces of movement bookkeeping measured in absolute time
   * rather than in the `deltaMs` the caller passes. Wall time by default,
   * which is what the live sim wants. The headless runners swap in the
   * simulation clock: a fast-forward compresses hours of simulated time into
   * seconds of wall time, so a wall-clock dwell would park a vehicle at its
   * first stop for the rest of the run — and make the output depend on how fast
   * the machine ran, which is the opposite of a deterministic generation.
   */
  private now: () => number = Date.now;

  /**
   * Learned-speed-profile `sim` source (see `speedprofiles/TraversalRecorder`),
   * or null when that source is off — the movement hot path then pays one null
   * check per edge transition.
   */
  private traversals: TraversalRecorder | null = null;

  constructor(
    private network: RoadNetwork,
    private registry: VehicleRegistry,
    private traffic: TrafficManager
  ) {
    super();
  }

  /** Replaces the dwell clock. See {@link now}. */
  setTimeSource(now: () => number): void {
    this.now = now;
  }

  /** Installs (or removes) the traversal recorder that feeds learned speed profiles. */
  setTraversalRecorder(recorder: TraversalRecorder | null): void {
    this.traversals = recorder;
  }

  // ─── Route getters ────────────────────────────────────────────────

  getRoute(vehicleId: string): Route | undefined {
    return this.routes.get(vehicleId);
  }

  setRoute(vehicleId: string, route: Route): void {
    this.setRouteFor(vehicleId, route);
  }

  deleteRoute(vehicleId: string): void {
    this.routes.delete(vehicleId);
    this.serializedRouteCache.delete(vehicleId);
    this.routePricing.delete(vehicleId);
  }

  /**
   * Single chokepoint for assigning a vehicle's active route. Invalidates the
   * vehicle's serialized-route cache so the next read re-serializes.
   */
  private setRouteFor(vehicleId: string, route: Route, arrivalEdge?: Edge): void {
    this.routes.set(vehicleId, route);
    this.serializedRouteCache.delete(vehicleId);
    this.routePricing.set(vehicleId, {
      pricing: this.price(vehicleId, route, arrivalEdge),
      arrivalEdge,
    });
  }

  /**
   * Prices a route with the vehicle's profile cap and the network's current
   * learned speeds, turn costs and weather factor. See `modules/eta.ts`.
   */
  private price(vehicleId: string, route: Route, arrivalEdge?: Edge): RoutePricing {
    const vehicle = this.registry.get(vehicleId);
    const profile = getProfile(vehicle?.type ?? "car");
    return priceRoute(
      route.edges,
      {
        learnedSpeedKmh: (edge) => this.network.learnedSpeedKmh(edge),
        turnCostHours: (from, to) => this.network.turnCostHours(from, to),
        weatherFactor: this.network.getWeatherFactor(),
        profileMaxSpeed: profile.maxSpeed,
      },
      arrivalEdge
    );
  }

  /**
   * The vehicle's cached route pricing, repriced if the weather factor has
   * moved since it was computed.
   *
   * Weather is the only pricing input that changes under a route that is
   * already assigned (a learned-profile refresh flushes the route cache and
   * reroutes follow; incidents reroute outright). Repricing is O(edges) but
   * only runs on the poll boundary that actually moved the factor, not per
   * tick.
   */
  private pricingFor(vehicleId: string): RoutePricing | undefined {
    const entry = this.routePricing.get(vehicleId);
    if (!entry) return undefined;
    const factor = this.network.getWeatherFactor();
    if (entry.pricing.pricedAtWeatherFactor !== factor) {
      const route = this.routes.get(vehicleId);
      if (!route) return entry.pricing;
      entry.pricing = this.price(vehicleId, route, entry.arrivalEdge);
    }
    return entry.pricing;
  }

  /**
   * Seconds until the vehicle reaches the end of its active route, from where
   * it is on that route right now. `undefined` when it has no route or has not
   * been placed on one yet — a gap the UI renders as "no ETA", never a
   * fabricated number.
   *
   * This is what goes on the wire every tick ({@link VehicleDTO.etaSeconds}).
   * It falls monotonically as the vehicle drives, and is independent of
   * `vehicle.speed`: a turn slowdown costs the seconds it actually costs on
   * the edge it happens on, instead of rescaling the whole remaining route.
   */
  etaSecondsFor(vehicle: Vehicle): number | undefined {
    const pricing = this.pricingFor(vehicle.id);
    if (!pricing) return undefined;
    const edgeIndex = this.routeEdgeIndex(vehicle);
    // Assigned but not yet ON the route: a route set from the end of the
    // current edge only reaches `edges[0]` at the next edge transition, which
    // can be a minute away on a long edge. The honest answer for that window is
    // the whole route — the trip has not started, not "no ETA".
    if (edgeIndex < 0) return pricing.totalSeconds;
    return remainingEtaSeconds(pricing, edgeIndex, vehicle.progress ?? 0);
  }

  /** Kilometres left on the active route, or `undefined`. See {@link etaSecondsFor}. */
  remainingKmFor(vehicle: Vehicle): number | undefined {
    const pricing = this.pricingFor(vehicle.id);
    if (!pricing) return undefined;
    const edgeIndex = this.routeEdgeIndex(vehicle);
    if (edgeIndex < 0) return pricing.suffixKm[0];
    return remainingDistanceKm(pricing, edgeIndex, vehicle.progress ?? 0);
  }

  /** Where a vehicle's ETA seconds go, for the active route. */
  etaBreakdownFor(vehicleId: string): EtaBreakdown | undefined {
    return this.pricingFor(vehicleId)?.breakdown;
  }

  /**
   * The vehicle's index into its route's edges, or -1 when it is not on the
   * route yet. `vehicle.edgeIndex` is -1 in the window between a route being
   * assigned and the vehicle being placed on its first edge, so fall back to
   * locating the current edge on the route — the same reconciliation
   * {@link peekNextEdge} does. That lookup misses for a route that starts at
   * the END of the current edge, which is exactly the not-started-yet case the
   * callers above translate into "the whole route".
   */
  private routeEdgeIndex(vehicle: Vehicle): number {
    if (vehicle.edgeIndex !== undefined && vehicle.edgeIndex >= 0) return vehicle.edgeIndex;
    const route = this.routes.get(vehicle.id);
    if (!route) return -1;
    return route.edges.findIndex((edge) => edge.id === vehicle.currentEdge.id);
  }

  /**
   * Returns the lean, serialized (non-circular) form of a vehicle's route,
   * computing it once and caching until the route changes.
   */
  private getSerializedRoute(vehicleId: string, route: Route): Route {
    let serialized = this.serializedRouteCache.get(vehicleId);
    if (!serialized) {
      serialized = utils.nonCircularRouteEdges(route);
      this.serializedRouteCache.set(vehicleId, serialized);
    }
    return serialized;
  }

  getDirections(): Direction[] {
    return Array.from(this.routes.entries()).map(([id, route]) => {
      const vehicle = this.registry.get(id)!;
      const direction: Direction = {
        vehicleId: id,
        route: this.getSerializedRoute(id, route),
        // Remaining, not whole-route: this snapshot describes routes already in
        // flight, so the useful number is the time still to run.
        eta: this.etaSecondsFor(vehicle),
        etaBreakdown: this.etaBreakdownFor(id),
      };
      if (vehicle.waypoints) {
        direction.waypoints = vehicle.waypoints;
        direction.currentWaypointIndex = vehicle.currentWaypointIndex;
      }
      return direction;
    });
  }

  /**
   * Every routed vehicle's whole-route ETA and breakdown, repriced at the
   * network's current state.
   *
   * Broadcast on the `eta` channel when the weather factor moves (see
   * `setup/eventWiring`). Deliberately not the route: re-sending every route to
   * correct a number would dwarf the correction, and the route has not changed.
   */
  getEtaUpdates(): VehicleEtaUpdate[] {
    const updates: VehicleEtaUpdate[] = [];
    for (const vehicleId of this.routes.keys()) {
      const pricing = this.pricingFor(vehicleId);
      if (!pricing) continue;
      updates.push({
        vehicleId,
        eta: pricing.totalSeconds,
        etaBreakdown: pricing.breakdown,
      });
    }
    return updates;
  }

  // ─── Random destination ───────────────────────────────────────────

  private pickDestination(): Node {
    if (rng() < 0.6) {
      const poiNode = this.network.getRandomPOINode();
      if (poiNode) return poiNode;
    }
    return this.network.getRandomNode();
  }

  setRandomDestination(vehicleId: string): void {
    const vehicle = this.registry.get(vehicleId);
    if (!vehicle) return;

    const destination = this.pickDestination();

    const profile = getProfile(vehicle.type);
    this.routeFromCurrentEdge(vehicle, destination, profile.restrictedHighways)
      .then((route) => {
        if (!this.registry.has(vehicleId)) return;

        if (route) {
          // Same reasoning as findAndSetRoutes: a wander destination replaces a
          // multi-stop route, so its legs must not outlive it.
          this.clearWaypointState(vehicle);
          // Routed from the end of the current edge, so that edge is the
          // arrival edge and its turn onto the route is charged.
          this.setRouteFor(vehicleId, route, vehicle.currentEdge);
          vehicle.edgeIndex = -1;
          if (this.unroutedAttempts.delete(vehicleId)) {
            setUnroutedVehicles(this.countUnroutedVehicles());
          }
          this.emit("direction", {
            vehicleId,
            route: this.getSerializedRoute(vehicleId, route),
            eta: this.pricingFor(vehicleId)?.totalSeconds,
            etaBreakdown: this.etaBreakdownFor(vehicleId),
            reason: "random",
          });
        }
      })
      .catch((error) => {
        logger.warn("Pathfinding failed for vehicle %s: %o", vehicleId, error);
      });
  }

  /**
   * Routes a moving vehicle from the end of its current edge, with that edge as
   * the search's arrival edge so the turn it makes there obeys the same bans,
   * U-turn rule and turn cost as every later turn. If that constraint leaves no
   * route (e.g. every exit is banned), retries unconstrained rather than
   * stranding the vehicle.
   */
  private async routeFromCurrentEdge(
    vehicle: Vehicle,
    destination: Node,
    restrictedHighways?: string[]
  ): Promise<Route | null> {
    const arrival = vehicle.currentEdge;
    const route = await this.network.findRouteAsync(
      arrival.end,
      destination,
      restrictedHighways,
      arrival
    );
    if (route) return route;
    return this.network.findRouteAsync(arrival.end, destination, restrictedHighways);
  }

  // ─── Next edge logic ──────────────────────────────────────────────

  /**
   * Side-effect-free lookahead for speed calculations.
   */
  peekNextEdge(vehicle: Vehicle): Edge {
    const currentEdge = vehicle.currentEdge;

    // If the vehicle is following a route, the turn it will actually make is
    // the next edge on that route — not an arbitrary connected edge. Resolve
    // it without mutating any state (this method must stay side-effect-free).
    const route = this.routes.get(vehicle.id);
    if (route && route.edges.length > 0) {
      let edgeIndex =
        vehicle.edgeIndex !== undefined && vehicle.edgeIndex >= 0 ? vehicle.edgeIndex : -1;
      if (edgeIndex < 0) {
        edgeIndex = route.edges.findIndex((e) => e.id === currentEdge.id);
      }
      if (edgeIndex >= 0 && edgeIndex < route.edges.length - 1) {
        return route.edges[edgeIndex + 1];
      }
      // Route exhausted or vehicle off-route → fall through to connected guess.
    }

    const possibleEdges = this.network.getConnectedEdges(currentEdge);
    if (possibleEdges.length === 0) {
      return this.network.getFallbackEdge(currentEdge);
    }
    return possibleEdges[0];
  }

  getNextEdge(vehicle: Vehicle): Edge {
    const currentEdge = vehicle.currentEdge;
    const possibleEdges = this.network.getConnectedEdges(currentEdge);
    if (possibleEdges.length === 0) {
      return this.network.getFallbackEdge(currentEdge);
    }
    const vehicleVisitedEdges = this.registry.getVisitedEdges(vehicle.id);
    const unvisitedEdges = possibleEdges.filter((e) => !vehicleVisitedEdges?.has(e.id));
    if (unvisitedEdges.length > 0) {
      const nextEdge = unvisitedEdges[Math.floor(rng() * unvisitedEdges.length)];
      vehicleVisitedEdges?.add(nextEdge.id);
      return nextEdge;
    }
    return possibleEdges[Math.floor(rng() * possibleEdges.length)];
  }

  /**
   * Get next edge for vehicle, either from route or random selection.
   */
  getNextEdgeForVehicle(
    vehicle: Vehicle,
    route?: Route
  ): { edge: Edge; edgeIndex?: number } | null {
    if (route) {
      let edgeIndex: number;
      if (vehicle.edgeIndex !== undefined && vehicle.edgeIndex >= 0) {
        edgeIndex = vehicle.edgeIndex;
      } else {
        edgeIndex = route.edges.findIndex((e) => e.id === vehicle.currentEdge.id);
        vehicle.edgeIndex = edgeIndex;
      }

      if (edgeIndex < route.edges.length - 1) {
        return {
          edge: route.edges[edgeIndex + 1],
          edgeIndex: edgeIndex + 1,
        };
      } else {
        return this.handleRouteCompleted(vehicle);
      }
    } else {
      const nextEdge = this.getNextEdge(vehicle);
      return { edge: nextEdge };
    }
  }

  /**
   * Handles when a vehicle completes its current route segment.
   */
  private handleRouteCompleted(vehicle: Vehicle): null {
    const multiRoute = this.waypointRoutes.get(vehicle.id);

    if (multiRoute && vehicle.waypoints && vehicle.currentWaypointIndex !== undefined) {
      const wpIndex = vehicle.currentWaypointIndex;
      const waypoint = vehicle.waypoints[wpIndex];
      const remaining = vehicle.waypoints.length - wpIndex - 1;

      this.emit("waypoint:reached", {
        vehicleId: vehicle.id,
        waypointIndex: wpIndex,
        waypointLabel: waypoint?.label,
        remaining,
      });

      if (wpIndex < vehicle.waypoints.length - 1) {
        const dwellSeconds = waypoint?.dwellTime ?? 10 + rng() * 50;
        vehicle.dwellUntil = this.now() + dwellSeconds * 1000;
        vehicle.speed = 0; // Will be set by caller via options.minSpeed

        const nextLeg = multiRoute.legs[wpIndex + 1];
        if (nextLeg) {
          this.setRouteFor(
            vehicle.id,
            { edges: nextLeg.edges, distance: nextLeg.distance },
            // The leg starts where the previous one ended, so the turn out of
            // the stop is charged like every other turn on the trip.
            vehicle.currentEdge
          );
          vehicle.currentWaypointIndex = wpIndex + 1;
          vehicle.edgeIndex = -1;
        }
        return null;
      } else {
        this.emit("route:completed", { vehicleId: vehicle.id });
        this.clearWaypointState(vehicle);
        const dwellSeconds = waypoint?.dwellTime ?? 10 + rng() * 50;
        vehicle.dwellUntil = this.now() + dwellSeconds * 1000;
        vehicle.speed = 0; // Will be set by caller via options.minSpeed
        this.deleteRoute(vehicle.id);
        return null;
      }
    }

    const dwellSeconds = 10 + rng() * 50;
    vehicle.dwellUntil = this.now() + dwellSeconds * 1000;
    vehicle.speed = 0; // Will be set by caller via options.minSpeed
    this.deleteRoute(vehicle.id);
    return null;
  }

  private clearWaypointState(vehicle: Vehicle): void {
    vehicle.waypoints = undefined;
    vehicle.currentWaypointIndex = undefined;
    this.waypointRoutes.delete(vehicle.id);
  }

  /** Current count of vehicles with at least one pending unrouted pathfind attempt. */
  private countUnroutedVehicles(): number {
    return this.unroutedAttempts.size;
  }

  // ─── Position update core ─────────────────────────────────────────

  /**
   * Unified position update logic for both random and route-based movement.
   */
  updatePositionCore(
    vehicle: Vehicle,
    deltaMs: number,
    options: StartOptions,
    route?: Route
  ): void {
    let remainingDistance = (vehicle.speed / 3600) * (deltaMs / 1000);
    // Learned speed profiles: only route-following vehicles are measured (see
    // TraversalRecorder). `msLeft` is the movement time not yet attributed to
    // an edge; speed is constant within a tick, so the time spent reaching an
    // edge's end is its share of the distance.
    const recorder = route ? this.traversals : null;
    let msLeft = deltaMs;

    while (remainingDistance > 0) {
      const edgeRemaining = (1 - vehicle.progress) * vehicle.currentEdge.distance;

      if (remainingDistance >= edgeRemaining) {
        vehicle.progress = 1;
        // speed > 0 here (remainingDistance > 0); km/h -> km per ms is / 3.6e6.
        const msToEnd = recorder ? edgeRemaining / (vehicle.speed / 3_600_000) : 0;
        remainingDistance -= edgeRemaining;

        this.updateVehiclePositionAndBearing(vehicle);

        const completedEdge = vehicle.currentEdge;
        const nextEdgeResult = this.getNextEdgeForVehicle(vehicle, route);
        if (recorder) {
          msLeft -= msToEnd;
          recorder.exit(vehicle, msToEnd, nextEdgeResult?.edge ?? null, options.turnThreshold);
        }
        if (!nextEdgeResult) {
          // Set speed from options after handleRouteCompleted set it to 0
          vehicle.speed = options.minSpeed;
          return;
        }

        const previousEdgeId = vehicle.currentEdge.id;
        this.traffic.leave(previousEdgeId);
        vehicle.currentEdge = nextEdgeResult.edge;
        this.traffic.enter(nextEdgeResult.edge.id);
        this.registry.moveInEdgeIndex(vehicle.id, previousEdgeId, nextEdgeResult.edge.id);
        vehicle.progress = 0;
        if (nextEdgeResult.edgeIndex !== undefined) {
          vehicle.edgeIndex = nextEdgeResult.edgeIndex;
        }
        recorder?.enter(vehicle, completedEdge, nextEdgeResult.edge, options.turnThreshold);
      } else {
        vehicle.progress += remainingDistance / vehicle.currentEdge.distance;
        remainingDistance = 0;

        this.updateVehiclePositionAndBearing(vehicle);
      }
    }
    // Whatever is left (including a whole tick at speed 0) was spent on the
    // edge the vehicle is on now.
    recorder?.accrue(vehicle, msLeft);
  }

  private updateVehiclePositionAndBearing(vehicle: Vehicle): void {
    vehicle.position = utils.interpolatePosition(
      vehicle.currentEdge.start.coordinates,
      vehicle.currentEdge.end.coordinates,
      vehicle.progress
    );
    vehicle.bearing = vehicle.currentEdge.bearing;
  }

  // ─── Vehicle update logic ─────────────────────────────────────────

  /**
   * Updates a single vehicle's state for one tick.
   */
  updateVehicle(vehicle: Vehicle, deltaMs: number, options: StartOptions): void {
    if (vehicle.dwellUntil) {
      if (this.now() < vehicle.dwellUntil) return;
      vehicle.dwellUntil = undefined;
      // A dwell at an INTERMEDIATE stop already has the next leg loaded (see
      // handleRouteCompleted), so the vehicle resumes its trip. Only a dwell
      // with nothing left to drive — the end of a route, where the route was
      // deleted — means the vehicle needs somewhere new to go. Wandering off
      // here regardless is what used to strand a job's dropoff leg.
      if (!this.routes.has(vehicle.id)) this.setRandomDestination(vehicle.id);
      return;
    }

    const route = this.routes.get(vehicle.id);
    this.updateSpeed(vehicle, deltaMs, options);

    if (!route || route.edges.length === 0) {
      this.updatePositionCore(vehicle, deltaMs, options);
      // Same clock as dwell: on wall time live, on simulated time headlessly,
      // where a wall-clock cooldown would gate retries on how fast the machine
      // ran the fast-forward instead of on simulated seconds.
      const now = this.now();
      const lastAttempt = this.lastPathfindAttempt.get(vehicle.id) ?? 0;
      if (now - lastAttempt > RouteManager.PATHFIND_COOLDOWN) {
        this.lastPathfindAttempt.set(vehicle.id, now);

        const attempts = (this.unroutedAttempts.get(vehicle.id) ?? 0) + 1;
        this.unroutedAttempts.set(vehicle.id, attempts);
        if (attempts === 1 || attempts % UNROUTED_LOG_SAMPLE_RATE === 0) {
          const unroutedForMs = attempts * RouteManager.PATHFIND_COOLDOWN;
          logger.warn(
            `Vehicle ${vehicle.id} still unrouted after ${attempts} pathfind attempt(s) (~${unroutedForMs}ms)`
          );
        }
        setUnroutedVehicles(this.countUnroutedVehicles());

        this.setRandomDestination(vehicle.id);
      }
    } else {
      this.updatePositionCore(vehicle, deltaMs, options, route);
    }
  }

  // ─── Heat-zone intensity ──────────────────────────────────────────

  /**
   * Intensity of the heat zone covering `position`, or null when no zone with a
   * usable intensity covers it. Overlapping zones resolve to the hottest one —
   * a vehicle inside two zones experiences the worse of them, not their sum.
   *
   * Delegates to `HeatZoneManager`, which already owns the spatial grid and the
   * point-in-polygon test. A second implementation here would eventually
   * disagree with the one deciding `isPositionInHeatZone`, and the speed model
   * would then penalise a vehicle the zone index says is outside every zone.
   *
   * A network that cannot answer (test doubles, future transports) yields null,
   * which is the legacy flat-penalty path.
   *
   * @param position - `[latitude, longitude]`.
   */
  private getHeatZoneIntensity(position: [number, number]): number | null {
    if (typeof this.network.getHeatZoneIntensityAt !== "function") return null;
    return this.network.getHeatZoneIntensityAt(position);
  }

  // ─── Speed update ─────────────────────────────────────────────────

  updateSpeed(vehicle: Vehicle, deltaMs: number, options: StartOptions): void {
    const profile = getProfile(vehicle.type);
    // Free-flow speed, not the posted limit: it is what the routing cost is
    // priced at, so simulated driving matches the ETA the route was chosen on.
    const edgeMaxSpeed = vehicle.currentEdge.freeFlowSpeed ?? vehicle.currentEdge.maxSpeed;

    const hour = this.getClockHour?.() ?? new Date().getHours();
    const isHighway =
      vehicle.currentEdge.highway === "trunk" || vehicle.currentEdge.highway === "primary";
    const timeSpeedModifier = (hour >= 22 || hour < 5) && isHighway ? 1.1 : 1.0;
    const adjustedEdgeMaxSpeed = edgeMaxSpeed * timeSpeedModifier;

    // Ambulances short-circuit before any intensity lookup: `ignoreHeatZones`
    // means heat zones do not exist for them, at ANY intensity.
    const inHeatZone =
      !profile.ignoreHeatZones && this.network.isPositionInHeatZone(vehicle.position);
    const speedFactor = inHeatZone
      ? heatZoneSpeedFactorFor(
          options.heatZoneSpeedFactor,
          this.getHeatZoneIntensity(vehicle.position)
        )
      : 1;
    const congestion = this.traffic.getCongestionFactor(
      vehicle.currentEdge.id,
      vehicle.currentEdge.distance,
      vehicle.currentEdge.highway
    );

    // ─── Heat zone vs BPR composition: MIN, not product ───────────────
    // These two terms are not independent. `TrafficManager.getCongestionFactor`
    // scales edge occupancy by `getDemandMultiplier(profile, hour, highway)`,
    // and heat-zone intensity is now `baseIntensity * getDemandMultiplier(...)`
    // from that SAME curve (see HeatZoneManager.applyTimeOfDay). Multiplying
    // them would apply the identical rush-hour demand signal twice — at 17:00
    // (demand 2.5 on arterials) a vehicle on a busy arterial inside a blooming
    // zone would eat a squared demand penalty that neither model claims.
    //
    // So they compose as the strongest binding constraint rather than a
    // product: whichever mechanism says "slower" governs. Each model keeps its
    // full individual range (heat zones alone still slow to their factor;
    // congestion alone still slows to its factor), the shared demand term is
    // counted exactly once, and — because both are <= 1 — the composed factor
    // is never weaker than either term alone.
    //
    // The rejected alternative was de-trending: dividing the demand multiplier
    // back out of the intensity before applying it. That leaves the product
    // intact but requires RouteManager to know the traffic profile, the zone's
    // baseIntensity (which the wire format does not carry) and the exact
    // clamping applyTimeOfDay used — three couplings that silently produce
    // wrong numbers the moment any of them drifts.
    const environmentFactor = Math.min(speedFactor, congestion);

    // Weather (fleetsim-all-1ajn.5) is a genuinely independent physical effect
    // — unlike heat zones and congestion it shares no demand curve with
    // anything else in this method — so it composes by MULTIPLYING rather than
    // MIN-ing with `environmentFactor`. That's the same composition
    // `applyDynamicCost` uses for weather x incidents in the routing cost, so a
    // route's ETA and how fast the vehicle actually drives it agree.
    const weatherFactor = this.network.getWeatherFactor();
    const effectiveMax =
      Math.min(profile.maxSpeed, adjustedEdgeMaxSpeed) * environmentFactor * weatherFactor;

    if (!vehicle.targetSpeed || rng() < deltaMs / 5000) {
      const variation = 1 + (rng() * 2 - 1) * options.speedVariation;
      vehicle.targetSpeed = Math.min(
        effectiveMax,
        Math.max(profile.minSpeed, effectiveMax * variation)
      );
    }

    const nextEdge = this.peekNextEdge(vehicle);
    if (nextEdge) {
      const rawDiff = Math.abs(nextEdge.bearing - vehicle.bearing);
      const bearingDiff = rawDiff > 180 ? 360 - rawDiff : rawDiff;
      if (bearingDiff > options.turnThreshold) {
        const sharpness = Math.min(bearingDiff / 180, 1);
        vehicle.targetSpeed = Math.max(profile.minSpeed, effectiveMax * (1 - sharpness * 0.6));
      }
    }

    const ahead = this.registry.findVehicleAhead(vehicle);

    if (ahead) {
      const gap = (ahead.progress - vehicle.progress) * vehicle.currentEdge.distance;
      const minGap = FOLLOWING_DISTANCE_BY_SIZE[profile.size];
      if (gap < minGap) {
        vehicle.targetSpeed = Math.min(vehicle.targetSpeed, ahead.speed * 0.9);
      }
    }

    const deltaSec = deltaMs / 1000;
    const accelRate =
      vehicle.speed < vehicle.targetSpeed ? profile.acceleration : profile.deceleration;
    const diff = vehicle.targetSpeed - vehicle.speed;
    const maxChange = accelRate * deltaSec;
    vehicle.speed = vehicle.speed + Math.sign(diff) * Math.min(Math.abs(diff), maxChange);
    vehicle.speed = Math.min(effectiveMax, Math.max(profile.minSpeed, vehicle.speed));
  }

  // ─── Clock integration ────────────────────────────────────────────

  /**
   * Set by the coordinator to provide clock hour for speed calculations.
   */
  getClockHour?: () => number;

  // ─── Pathfinding API ──────────────────────────────────────────────

  /**
   * Driving cost from a vehicle's current position to `destination`, WITHOUT
   * touching its route, edge or progress. Returns `null` when no route exists.
   *
   * This is the probe `JobManager`'s `best_eta` strategy runs against a handful
   * of candidate vehicles before committing one: assignment needs to compare
   * candidates, and `findAndSetRoutes` can't be used for that because it
   * teleports the vehicle onto the first edge of the route it finds.
   *
   * The ETA prices each edge at its free-flow speed capped by the profile's top
   * speed (the movement model's cap) rather than the vehicle's instantaneous
   * `speed`, because an idle candidate has `speed === 0` and
   * would otherwise price out at infinity — exactly backwards, since idle
   * vehicles are the ones worth dispatching.
   *
   * NOT identical to the route search's cost: the ETA models how the simulated
   * vehicle will actually drive the route, so it leaves out the terms the
   * search uses only to CHOOSE a route and that `updateSpeed` never applies to
   * movement — the static surface / smoothness / BPR penalties baked into the
   * base cost, and incident speed factors. Adding them here would make ETAs
   * disagree with simulated arrival times. Terms both sides share (free-flow
   * or learned speed, node delay, turn cost, weather) are priced identically.
   */
  async estimateTo(
    vehicleId: string,
    destination: [number, number]
  ): Promise<{ etaSeconds: number; distanceKm: number } | null> {
    const vehicle = this.registry.get(vehicleId);
    if (!vehicle) return null;

    const startNode = this.network.findNearestNode(vehicle.position);
    const endNode = this.network.findNearestNode(destination);
    if (startNode.connections.length === 0 || endNode.connections.length === 0) return null;

    const profile = getProfile(vehicle.type);
    // Starting at the end of the vehicle's current edge: search with it as the
    // arrival edge (same first-turn rules as a reroute) and charge that turn.
    let arrival: Edge | undefined =
      startNode.id === vehicle.currentEdge.end.id ? vehicle.currentEdge : undefined;
    let route = await this.network.findRouteAsync(
      startNode,
      endNode,
      profile.restrictedHighways,
      arrival
    );
    if (!route && arrival) {
      arrival = undefined;
      route = await this.network.findRouteAsync(startNode, endNode, profile.restrictedHighways);
    }
    if (!route || route.edges.length === 0) return null;

    // Each edge at the speed the movement model caps it at: the edge's free-flow
    // speed, limited by the profile's top speed. Independent of `vehicle.speed`,
    // so an idle candidate still gets a finite ETA. Plus each edge's precomputed
    // node-control delay (signal/stop/give-way/crossing/level-crossing/traffic-
    // calming at the edge's end) — the same term `applyDynamicCost` adds during
    // pathfinding, so `best_eta` candidate comparisons and the route search
    // price a stop/signal the same way. `updateSpeed` below has no stopping
    // logic of its own (it only slows for turns/following distance/heat zones/
    // congestion), so there is nothing to double-count against.
    //
    // Plus the turn cost between consecutive edges, again exactly as the search
    // charges it (pathfinding/turns.ts) — including the first turn off the
    // vehicle's current edge when the route starts at its end node. This deliberately does NOT mirror
    // `updateSpeed`'s turn slowdown: that one is a pure-geometry speed dip
    // (any bearing change over TURN_THRESHOLD, drive-side agnostic) whose time
    // loss depends on the vehicle's acceleration profile, while the turn
    // penalty prices the manoeuvre (yielding, crossing oncoming traffic,
    // U-turns) that the movement model does not simulate. Both share the 30°
    // "straight on" threshold by default.
    //
    // An edge with a learned speed in the active profile (speedprofiles/) is
    // priced at that speed instead of free-flow — the (clamped) value the route
    // search itself charged — still capped by the vehicle profile.
    //
    // The global weather factor (fleetsim-all-1ajn.5) scales the resulting
    // speed down, exactly like `applyDynamicCost` scales travel TIME down by
    // the same factor for routing cost (dividing time by a factor < 1 is
    // equivalent to multiplying speed by it), and like `updateSpeed` scales
    // movement. Node delay is NOT scaled by weather (a red
    // light's expected wait doesn't get longer in the rain the way a moving
    // edge's travel time does), matching the routing cost side.
    const pricing = priceRoute(
      route.edges,
      {
        learnedSpeedKmh: (edge) => this.network.learnedSpeedKmh(edge),
        turnCostHours: (from, to) => this.network.turnCostHours(from, to),
        weatherFactor: this.network.getWeatherFactor(),
        profileMaxSpeed: profile.maxSpeed,
      },
      arrival
    );
    return {
      etaSeconds: pricing.totalSeconds,
      distanceKm: route.distance,
    };
  }

  async findAndSetRoutes(
    vehicleId: string,
    destination: [number, number]
  ): Promise<DirectionResult> {
    const vehicle = this.registry.get(vehicleId);
    if (!vehicle) {
      return {
        vehicleId,
        status: "error",
        error: `Vehicle ${vehicleId} not found`,
      };
    }

    const endNode = this.network.findNearestNode(destination);
    const startNode = this.network.findNearestNode(vehicle.position);

    if (startNode.connections.length === 0 || endNode.connections.length === 0) {
      return {
        vehicleId,
        status: "error",
        error: "Start or end node has no connections",
        snappedTo: endNode.coordinates,
      };
    }

    const profile = getProfile(vehicle.type);
    const route = await this.network.findRouteAsync(startNode, endNode, profile.restrictedHighways);
    if (!route || route.edges.length === 0) {
      return {
        vehicleId,
        status: "error",
        error: "No route found to destination",
        snappedTo: endNode.coordinates,
      };
    }

    // A single-destination route replaces any multi-stop one outright. Without
    // this the stale legs survive: `handleRouteCompleted` would take the
    // multi-stop branch when THIS route finishes, emit a `waypoint:reached` for
    // the abandoned trip, and put the vehicle back onto its next leg.
    this.clearWaypointState(vehicle);
    // Unconstrained search from the nearest node, so there is no arrival edge
    // and no first turn to charge — the vehicle is placed on `edges[0]` below.
    this.setRouteFor(vehicleId, route);
    const eta = this.pricingFor(vehicleId)?.totalSeconds;
    this.emit("direction", {
      vehicleId,
      route: this.getSerializedRoute(vehicleId, route),
      eta,
      etaBreakdown: this.etaBreakdownFor(vehicleId),
      reason: "dispatch",
    });
    const previousEdgeId = vehicle.currentEdge.id;
    this.traffic.leave(previousEdgeId);
    vehicle.currentEdge = route.edges[0];
    this.traffic.enter(vehicle.currentEdge.id);
    this.registry.moveInEdgeIndex(vehicleId, previousEdgeId, vehicle.currentEdge.id);
    vehicle.progress = 0;
    vehicle.edgeIndex = 0;

    return {
      vehicleId,
      status: "ok",
      route: {
        start: startNode.coordinates,
        end: endNode.coordinates,
        distance: route.distance,
      },
      eta,
      snappedTo: endNode.coordinates,
    };
  }

  async findAndSetWaypointRoutes(
    vehicleId: string,
    waypoints: Waypoint[]
  ): Promise<DirectionResult> {
    const vehicle = this.registry.get(vehicleId);
    if (!vehicle) {
      return {
        vehicleId,
        status: "error",
        error: `Vehicle ${vehicleId} not found`,
      };
    }

    if (waypoints.length === 0) {
      return { vehicleId, status: "error", error: "No waypoints provided" };
    }

    const positions: [number, number][] = [vehicle.position, ...waypoints.map((wp) => wp.position)];
    const legs: { edges: Edge[]; distance: number; waypointIndex: number }[] = [];
    const legResults: {
      start: [number, number];
      end: [number, number];
      distance: number;
    }[] = [];

    const waypointProfile = getProfile(vehicle.type);
    for (let i = 0; i < positions.length - 1; i++) {
      const startNode = this.network.findNearestNode(positions[i]);
      const endNode = this.network.findNearestNode(positions[i + 1]);

      if (startNode.connections.length === 0 || endNode.connections.length === 0) {
        return {
          vehicleId,
          status: "error",
          error: `Waypoint ${i} has no connected road nearby`,
          snappedTo: endNode.coordinates,
        };
      }

      const route = await this.network.findRouteAsync(
        startNode,
        endNode,
        waypointProfile.restrictedHighways
      );
      if (!route || route.edges.length === 0) {
        return {
          vehicleId,
          status: "error",
          error: `No route found for leg ${i} (waypoint ${i} → ${i + 1})`,
          snappedTo: endNode.coordinates,
        };
      }

      legs.push({
        edges: route.edges,
        distance: route.distance,
        waypointIndex: i,
      });
      legResults.push({
        start: startNode.coordinates,
        end: endNode.coordinates,
        distance: route.distance,
      });
    }

    const totalDistance = legs.reduce((sum, leg) => sum + leg.distance, 0);
    const allEdges = legs.flatMap((leg) => leg.edges);

    const multiRoute: MultiStopRoute = { legs, totalDistance };
    this.waypointRoutes.set(vehicleId, multiRoute);

    vehicle.waypoints = waypoints;
    vehicle.currentWaypointIndex = 0;

    const firstLeg = legs[0];
    const stitchedRoute: Route = { edges: allEdges, distance: totalDistance };
    this.setRouteFor(vehicleId, {
      edges: firstLeg.edges,
      distance: firstLeg.distance,
    });

    const previousEdgeId = vehicle.currentEdge.id;
    this.traffic.leave(previousEdgeId);
    vehicle.currentEdge = firstLeg.edges[0];
    this.traffic.enter(vehicle.currentEdge.id);
    this.registry.moveInEdgeIndex(vehicleId, previousEdgeId, vehicle.currentEdge.id);
    vehicle.progress = 0;
    vehicle.edgeIndex = 0;

    // The whole trip, not the active first leg: a multi-stop direction is the
    // client's view of the entire run, so it is priced (and serialized) on the
    // stitched route rather than through the per-vehicle active-route caches.
    const stitchedPricing = this.price(vehicleId, stitchedRoute);

    // The emitted direction shows the full stitched multi-leg route, which is
    // distinct from the active (first-leg) route stored above — so it is
    // serialized directly rather than via the per-vehicle active-route cache.
    this.emit("direction", {
      vehicleId,
      route: utils.nonCircularRouteEdges(stitchedRoute),
      eta: stitchedPricing.totalSeconds,
      etaBreakdown: stitchedPricing.breakdown,
      waypoints,
      currentWaypointIndex: 0,
      reason: "waypoints",
    });

    return {
      vehicleId,
      status: "ok",
      route: {
        start: legResults[0].start,
        end: legResults[legResults.length - 1].end,
        distance: totalDistance,
      },
      eta: stitchedPricing.totalSeconds,
      snappedTo: legResults[legResults.length - 1].end,
      waypointCount: waypoints.length,
      legs: legResults,
    };
  }

  // ─── Incident rerouting ───────────────────────────────────────────

  handleIncidentCreated(incident: Incident): void {
    const affectedEdgeIds = new Set(incident.edgeIds);

    // Enqueue every affected vehicle; the drainer dispatches them in staggered
    // batches so a mass reroute does not flood (and overflow) the worker-pool
    // queue. Re-queuing an already-pending vehicle just updates its incident id.
    for (const [vehicleId, route] of this.routes) {
      const vehicle = this.registry.get(vehicleId);
      if (!vehicle) continue;

      const currentIdx = vehicle.edgeIndex ?? 0;
      const hasOverlap = route.edges.some(
        (edge, idx) => idx > currentIdx && affectedEdgeIds.has(edge.id)
      );
      if (!hasOverlap) continue;

      this.rerouteQueue.set(vehicleId, incident.id);
    }

    this.scheduleRerouteDrain();
  }

  /** Starts the staggered drain loop if it is not already running. */
  private scheduleRerouteDrain(): void {
    if (this.rerouteDrainTimer || this.rerouteQueue.size === 0) return;
    this.rerouteDrainTimer = setTimeout(() => this.drainRerouteQueue(), 0);
  }

  /** Dispatches up to one batch of pending reroutes, then reschedules if more remain. */
  private drainRerouteQueue(): void {
    this.rerouteDrainTimer = null;

    let dispatched = 0;
    for (const [vehicleId, incidentId] of this.rerouteQueue) {
      if (dispatched >= RouteManager.REROUTE_BATCH_SIZE) break;
      this.rerouteQueue.delete(vehicleId);
      dispatched += 1;
      this.dispatchReroute(vehicleId, incidentId);
    }

    if (this.rerouteQueue.size > 0) {
      this.rerouteDrainTimer = setTimeout(
        () => this.drainRerouteQueue(),
        RouteManager.REROUTE_STAGGER_MS
      );
    }
  }

  /** Pathfinds a fresh route for one vehicle and applies it if still valid. */
  private dispatchReroute(vehicleId: string, incidentId: string): void {
    const vehicle = this.registry.get(vehicleId);
    const route = this.routes.get(vehicleId);
    if (!vehicle || !route) return;

    const lastEdge = route.edges[route.edges.length - 1];
    const destinationNode = lastEdge.end;
    const rerouteProfile = getProfile(vehicle.type);

    this.routeFromCurrentEdge(vehicle, destinationNode, rerouteProfile.restrictedHighways)
      .then((newRoute) => {
        if (!this.registry.has(vehicleId)) return;
        if (!this.routes.has(vehicleId)) return;

        if (newRoute && newRoute.edges.length > 0) {
          this.setRouteFor(vehicleId, newRoute, vehicle.currentEdge);
          vehicle.edgeIndex = -1;

          const serialized = this.getSerializedRoute(vehicleId, newRoute);
          this.emit("vehicle:rerouted", {
            vehicleId,
            incidentId,
            newRoute: serialized,
          });

          this.emit("direction", {
            vehicleId,
            route: serialized,
            eta: this.pricingFor(vehicleId)?.totalSeconds,
            etaBreakdown: this.etaBreakdownFor(vehicleId),
            reason: "reroute",
          });
        }
      })
      .catch((error) => {
        logger.warn("Reroute pathfinding failed for vehicle %s: %o", vehicleId, error);
      });
  }

  handleIncidentCleared(_incidentId: string): void {
    // noop -- reserved for future use
  }

  // ─── Reset ────────────────────────────────────────────────────────

  reset(): void {
    this.routes = new Map();
    this.waypointRoutes = new Map();
    this.lastPathfindAttempt = new Map();
    this.serializedRouteCache = new Map();
    this.routePricing = new Map();
    this.rerouteQueue.clear();
    if (this.rerouteDrainTimer) {
      clearTimeout(this.rerouteDrainTimer);
      this.rerouteDrainTimer = null;
    }
    this.unroutedAttempts.clear();
    setUnroutedVehicles(0);
  }
}
