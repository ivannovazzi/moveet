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

/**
 * After the first "vehicle still unrouted" warning is logged for a vehicle,
 * repeat warnings are only logged every Nth retry so a vehicle stuck with no
 * reachable destination doesn't flood the logs. Mirrors GameLoop's
 * FAILURE_LOG_SAMPLE_RATE pattern.
 */
export const UNROUTED_LOG_SAMPLE_RATE = 100;

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

  constructor(
    private network: RoadNetwork,
    private registry: VehicleRegistry,
    private traffic: TrafficManager
  ) {
    super();
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
  }

  /**
   * Single chokepoint for assigning a vehicle's active route. Invalidates the
   * vehicle's serialized-route cache so the next read re-serializes.
   */
  private setRouteFor(vehicleId: string, route: Route): void {
    this.routes.set(vehicleId, route);
    this.serializedRouteCache.delete(vehicleId);
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
        eta: utils.estimateRouteDuration(route, vehicle.speed),
      };
      if (vehicle.waypoints) {
        direction.waypoints = vehicle.waypoints;
        direction.currentWaypointIndex = vehicle.currentWaypointIndex;
      }
      return direction;
    });
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
    const startNode = vehicle.currentEdge.end;

    const profile = getProfile(vehicle.type);
    this.network
      .findRouteAsync(startNode, destination, profile.restrictedHighways)
      .then((route) => {
        if (!this.registry.has(vehicleId)) return;

        if (route) {
          this.setRouteFor(vehicleId, route);
          vehicle.edgeIndex = -1;
          if (this.unroutedAttempts.delete(vehicleId)) {
            setUnroutedVehicles(this.countUnroutedVehicles());
          }
          this.emit("direction", {
            vehicleId,
            route: this.getSerializedRoute(vehicleId, route),
            eta: utils.estimateRouteDuration(route, vehicle.speed),
          });
        }
      })
      .catch((error) => {
        logger.warn("Pathfinding failed for vehicle %s: %o", vehicleId, error);
      });
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
        vehicle.dwellUntil = Date.now() + dwellSeconds * 1000;
        vehicle.speed = 0; // Will be set by caller via options.minSpeed

        const nextLeg = multiRoute.legs[wpIndex + 1];
        if (nextLeg) {
          this.setRouteFor(vehicle.id, { edges: nextLeg.edges, distance: nextLeg.distance });
          vehicle.currentWaypointIndex = wpIndex + 1;
          vehicle.edgeIndex = -1;
        }
        return null;
      } else {
        this.emit("route:completed", { vehicleId: vehicle.id });
        this.clearWaypointState(vehicle);
        const dwellSeconds = waypoint?.dwellTime ?? 10 + rng() * 50;
        vehicle.dwellUntil = Date.now() + dwellSeconds * 1000;
        vehicle.speed = 0; // Will be set by caller via options.minSpeed
        this.deleteRoute(vehicle.id);
        return null;
      }
    }

    const dwellSeconds = 10 + rng() * 50;
    vehicle.dwellUntil = Date.now() + dwellSeconds * 1000;
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

    while (remainingDistance > 0) {
      const edgeRemaining = (1 - vehicle.progress) * vehicle.currentEdge.distance;

      if (remainingDistance >= edgeRemaining) {
        vehicle.progress = 1;
        remainingDistance -= edgeRemaining;

        this.updateVehiclePositionAndBearing(vehicle);

        const nextEdgeResult = this.getNextEdgeForVehicle(vehicle, route);
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
      } else {
        vehicle.progress += remainingDistance / vehicle.currentEdge.distance;
        remainingDistance = 0;

        this.updateVehiclePositionAndBearing(vehicle);
      }
    }
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
      if (Date.now() < vehicle.dwellUntil) return;
      vehicle.dwellUntil = undefined;
      this.setRandomDestination(vehicle.id);
      return;
    }

    const route = this.routes.get(vehicle.id);
    this.updateSpeed(vehicle, deltaMs, options);

    if (!route || route.edges.length === 0) {
      this.updatePositionCore(vehicle, deltaMs, options);
      const now = Date.now();
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

  // ─── Speed update ─────────────────────────────────────────────────

  updateSpeed(vehicle: Vehicle, deltaMs: number, options: StartOptions): void {
    const profile = getProfile(vehicle.type);
    const edgeMaxSpeed = vehicle.currentEdge.maxSpeed;

    const hour = this.getClockHour?.() ?? new Date().getHours();
    const isHighway =
      vehicle.currentEdge.highway === "trunk" || vehicle.currentEdge.highway === "primary";
    const timeSpeedModifier = (hour >= 22 || hour < 5) && isHighway ? 1.1 : 1.0;
    const adjustedEdgeMaxSpeed = edgeMaxSpeed * timeSpeedModifier;

    const isInHeatZone = this.network.isPositionInHeatZone(vehicle.position);
    const speedFactor = isInHeatZone && !profile.ignoreHeatZones ? options.heatZoneSpeedFactor : 1;
    const congestion = this.traffic.getCongestionFactor(
      vehicle.currentEdge.id,
      vehicle.currentEdge.distance,
      vehicle.currentEdge.highway
    );
    const effectiveMax =
      Math.min(profile.maxSpeed, adjustedEdgeMaxSpeed) * speedFactor * congestion;

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

  async findAndSetRoutes(
    vehicleId: string,
    destination: [number, number]
  ): Promise<DirectionResult> {
    const vehicle = this.registry.get(vehicleId);
    if (!vehicle) {
      return { vehicleId, status: "error", error: `Vehicle ${vehicleId} not found` };
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

    const eta = utils.estimateRouteDuration(route, vehicle.speed);

    this.setRouteFor(vehicleId, route);
    this.emit("direction", {
      vehicleId,
      route: this.getSerializedRoute(vehicleId, route),
      eta,
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
      return { vehicleId, status: "error", error: `Vehicle ${vehicleId} not found` };
    }

    if (waypoints.length === 0) {
      return { vehicleId, status: "error", error: "No waypoints provided" };
    }

    const positions: [number, number][] = [vehicle.position, ...waypoints.map((wp) => wp.position)];
    const legs: { edges: Edge[]; distance: number; waypointIndex: number }[] = [];
    const legResults: { start: [number, number]; end: [number, number]; distance: number }[] = [];

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

      legs.push({ edges: route.edges, distance: route.distance, waypointIndex: i });
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
    this.setRouteFor(vehicleId, { edges: firstLeg.edges, distance: firstLeg.distance });

    const previousEdgeId = vehicle.currentEdge.id;
    this.traffic.leave(previousEdgeId);
    vehicle.currentEdge = firstLeg.edges[0];
    this.traffic.enter(vehicle.currentEdge.id);
    this.registry.moveInEdgeIndex(vehicleId, previousEdgeId, vehicle.currentEdge.id);
    vehicle.progress = 0;
    vehicle.edgeIndex = 0;

    const eta = utils.estimateRouteDuration(stitchedRoute, vehicle.speed);

    // The emitted direction shows the full stitched multi-leg route, which is
    // distinct from the active (first-leg) route stored above — so it is
    // serialized directly rather than via the per-vehicle active-route cache.
    this.emit("direction", {
      vehicleId,
      route: utils.nonCircularRouteEdges(stitchedRoute),
      eta,
      waypoints,
      currentWaypointIndex: 0,
    });

    return {
      vehicleId,
      status: "ok",
      route: {
        start: legResults[0].start,
        end: legResults[legResults.length - 1].end,
        distance: totalDistance,
      },
      eta,
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

    const startNode = vehicle.currentEdge.end;
    const lastEdge = route.edges[route.edges.length - 1];
    const destinationNode = lastEdge.end;
    const rerouteProfile = getProfile(vehicle.type);

    this.network
      .findRouteAsync(startNode, destinationNode, rerouteProfile.restrictedHighways)
      .then((newRoute) => {
        if (!this.registry.has(vehicleId)) return;
        if (!this.routes.has(vehicleId)) return;

        if (newRoute && newRoute.edges.length > 0) {
          this.setRouteFor(vehicleId, newRoute);
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
            eta: utils.estimateRouteDuration(newRoute, vehicle.speed),
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
    this.rerouteQueue.clear();
    if (this.rerouteDrainTimer) {
      clearTimeout(this.rerouteDrainTimer);
      this.rerouteDrainTimer = null;
    }
    this.unroutedAttempts.clear();
    setUnroutedVehicles(0);
  }
}
