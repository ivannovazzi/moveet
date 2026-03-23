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
import logger from "../utils/logger";

/**
 * Manages route/waypoint tracking, pathfinding, and route-based movement.
 * Emits: 'direction', 'waypoint:reached', 'route:completed', 'vehicle:rerouted'
 */
export class RouteManager extends EventEmitter {
  private routes: Map<string, Route> = new Map();
  private waypointRoutes: Map<string, MultiStopRoute> = new Map();
  private lastPathfindAttempt: Map<string, number> = new Map();
  private static readonly PATHFIND_COOLDOWN = 3000;

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
    this.routes.set(vehicleId, route);
  }

  deleteRoute(vehicleId: string): void {
    this.routes.delete(vehicleId);
  }

  getDirections(): Direction[] {
    return Array.from(this.routes.entries()).map(([id, route]) => {
      const vehicle = this.registry.get(id)!;
      const direction: Direction = {
        vehicleId: id,
        route: utils.nonCircularRouteEdges(route),
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
    if (Math.random() < 0.6) {
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
          this.routes.set(vehicleId, route);
          vehicle.edgeIndex = -1;
          this.emit("direction", {
            vehicleId,
            route: utils.nonCircularRouteEdges(route),
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
    const possibleEdges = this.network.getConnectedEdges(currentEdge);
    if (possibleEdges.length === 0) {
      return {
        ...currentEdge,
        start: currentEdge.end,
        end: currentEdge.start,
        bearing: (currentEdge.bearing + 180) % 360,
        oneway: false,
      };
    }
    return possibleEdges[0];
  }

  getNextEdge(vehicle: Vehicle): Edge {
    const currentEdge = vehicle.currentEdge;
    const possibleEdges = this.network.getConnectedEdges(currentEdge);
    if (possibleEdges.length === 0) {
      return {
        ...currentEdge,
        start: currentEdge.end,
        end: currentEdge.start,
        bearing: (currentEdge.bearing + 180) % 360,
        oneway: false,
      };
    }
    const vehicleVisitedEdges = this.registry.getVisitedEdges(vehicle.id);
    const unvisitedEdges = possibleEdges.filter((e) => !vehicleVisitedEdges?.has(e.id));
    if (unvisitedEdges.length > 0) {
      const nextEdge = unvisitedEdges[Math.floor(Math.random() * unvisitedEdges.length)];
      vehicleVisitedEdges?.add(nextEdge.id);
      return nextEdge;
    }
    return possibleEdges[Math.floor(Math.random() * possibleEdges.length)];
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
        const dwellSeconds = waypoint?.dwellTime ?? 10 + Math.random() * 50;
        vehicle.dwellUntil = Date.now() + dwellSeconds * 1000;
        vehicle.speed = 0; // Will be set by caller via options.minSpeed

        const nextLeg = multiRoute.legs[wpIndex + 1];
        if (nextLeg) {
          this.routes.set(vehicle.id, { edges: nextLeg.edges, distance: nextLeg.distance });
          vehicle.currentWaypointIndex = wpIndex + 1;
          vehicle.edgeIndex = -1;
        }
        return null;
      } else {
        this.emit("route:completed", { vehicleId: vehicle.id });
        this.clearWaypointState(vehicle);
        const dwellSeconds = waypoint?.dwellTime ?? 10 + Math.random() * 50;
        vehicle.dwellUntil = Date.now() + dwellSeconds * 1000;
        vehicle.speed = 0; // Will be set by caller via options.minSpeed
        this.routes.delete(vehicle.id);
        return null;
      }
    }

    const dwellSeconds = 10 + Math.random() * 50;
    vehicle.dwellUntil = Date.now() + dwellSeconds * 1000;
    vehicle.speed = 0; // Will be set by caller via options.minSpeed
    this.routes.delete(vehicle.id);
    return null;
  }

  private clearWaypointState(vehicle: Vehicle): void {
    vehicle.waypoints = undefined;
    vehicle.currentWaypointIndex = undefined;
    this.waypointRoutes.delete(vehicle.id);
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

    if (!vehicle.targetSpeed || Math.random() < deltaMs / 5000) {
      const variation = 1 + (Math.random() * 2 - 1) * options.speedVariation;
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

    this.emit("direction", {
      vehicleId,
      route: utils.nonCircularRouteEdges(route),
      eta,
    });
    this.routes.set(vehicleId, route);
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
    this.routes.set(vehicleId, { edges: firstLeg.edges, distance: firstLeg.distance });

    const previousEdgeId = vehicle.currentEdge.id;
    this.traffic.leave(previousEdgeId);
    vehicle.currentEdge = firstLeg.edges[0];
    this.traffic.enter(vehicle.currentEdge.id);
    this.registry.moveInEdgeIndex(vehicleId, previousEdgeId, vehicle.currentEdge.id);
    vehicle.progress = 0;
    vehicle.edgeIndex = 0;

    const eta = utils.estimateRouteDuration(stitchedRoute, vehicle.speed);

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

    for (const [vehicleId, route] of this.routes) {
      const vehicle = this.registry.get(vehicleId);
      if (!vehicle) continue;

      const currentIdx = vehicle.edgeIndex ?? 0;

      const hasOverlap = route.edges.some(
        (edge, idx) => idx > currentIdx && affectedEdgeIds.has(edge.id)
      );

      if (!hasOverlap) continue;

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
            this.routes.set(vehicleId, newRoute);
            vehicle.edgeIndex = -1;

            this.emit("vehicle:rerouted", {
              vehicleId,
              incidentId: incident.id,
              newRoute: utils.nonCircularRouteEdges(newRoute),
            });

            this.emit("direction", {
              vehicleId,
              route: utils.nonCircularRouteEdges(newRoute),
              eta: utils.estimateRouteDuration(newRoute, vehicle.speed),
            });
          }
        })
        .catch((error) => {
          logger.warn("Reroute pathfinding failed for vehicle %s: %o", vehicleId, error);
        });
    }
  }

  handleIncidentCleared(_incidentId: string): void {
    // noop -- reserved for future use
  }

  // ─── Reset ────────────────────────────────────────────────────────

  reset(): void {
    this.routes = new Map();
    this.waypointRoutes = new Map();
    this.lastPathfindAttempt = new Map();
  }
}
