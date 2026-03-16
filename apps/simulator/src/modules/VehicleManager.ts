import type {
  Vehicle,
  DataVehicle,
  Edge,
  Incident,
  Node,
  VehicleDTO,
  Route,
  Direction,
  DirectionResult,
  StartOptions,
  Waypoint,
  MultiStopRoute,
  TrafficProfile,
} from "../types";
import { SimulationClock } from "./SimulationClock";
import { VEHICLE_CONSTANTS } from "../constants";
import type { RoadNetwork } from "./RoadNetwork";
import { config } from "../utils/config";
import { CircularBuffer } from "../utils/CircularBuffer";
import { EventEmitter } from "events";
import * as utils from "../utils/helpers";
import { serializeVehicle } from "../utils/serializer";
import { TrafficManager } from "./TrafficManager";
import { FleetManager } from "./FleetManager";
import Adapter from "./Adapter";
import logger from "../utils/logger";

export class VehicleManager extends EventEmitter {
  private vehicles: Map<string, Vehicle> = new Map();
  private visitedEdges: Map<string, CircularBuffer<string>> = new Map();
  private routes: Map<string, Route> = new Map();
  private waypointRoutes: Map<string, MultiStopRoute> = new Map();
  private locationInterval: NodeJS.Timeout | null = null;
  private lastUpdateTimes: Map<string, number> = new Map();
  private lastPathfindAttempt: Map<string, number> = new Map();
  private static readonly PATHFIND_COOLDOWN = 3000;
  private adapter = new Adapter();
  public readonly clock = new SimulationClock({ startHour: 7, speedMultiplier: 1 });
  private traffic = new TrafficManager(this.clock);
  public readonly fleets = new FleetManager();

  // Task 1: Single game loop instead of per-vehicle setInterval
  private activeVehicles: Set<string> = new Set();
  private gameLoopInterval: NodeJS.Timeout | null = null;
  private gameLoopIntervalMs: number = config.updateInterval;
  private lastClockTick: number = Date.now();

  // Task 2: Edge → vehicle spatial index for O(1) lookups
  private vehiclesByEdge: Map<string, Set<string>> = new Map();

  private options: StartOptions = {
    updateInterval: config.updateInterval,
    minSpeed: config.minSpeed,
    maxSpeed: config.maxSpeed,
    speedVariation: config.speedVariation,
    acceleration: config.acceleration,
    deceleration: config.deceleration,
    turnThreshold: config.turnThreshold,
    heatZoneSpeedFactor: config.heatZoneSpeedFactor,
  };

  constructor(
    private network: RoadNetwork,
    private fleetManager: FleetManager
  ) {
    super();
    this.init();
  }

  private init(): void {
    if (!config.adapterURL) {
      this.loadFromData();
    }
    // When adapterURL is set, vehicles are loaded via initFromAdapter()
  }

  /**
   * Fetches vehicles from the adapter and initializes them.
   * Must be called after construction when ADAPTER_URL is configured.
   */
  public async initFromAdapter(): Promise<void> {
    if (!config.adapterURL) return;

    try {
      const adapterVehicles = await this.adapter.get();
      if (adapterVehicles.length === 0) {
        logger.warn("Adapter returned no vehicles, falling back to default data");
        this.loadFromData();
        return;
      }
      adapterVehicles.forEach((v) => {
        this.addVehicle(v.id, v.name, v.position);
      });
      logger.info(`Loaded ${adapterVehicles.length} vehicles from adapter`);
    } catch (error) {
      logger.error(`Failed to load vehicles from adapter: ${error}`);
      logger.warn("Falling back to default vehicle data");
      this.loadFromData();
    }
  }

  private loadFromData(): void {
    for (let i = 0; i < config.vehicleCount; i++) {
      this.addVehicle(i.toString(), `V${i}`);
    }
  }

  /**
   * Fetches vehicle definitions from the adapter (async) or returns null
   * to indicate that default data should be used.
   * This isolates the async I/O from any map mutation so that
   * this.vehicles stays untouched during the await.
   */
  private async fetchAdapterVehicles(): Promise<DataVehicle[] | null> {
    if (!config.adapterURL) return null;

    try {
      const adapterVehicles = await this.adapter.get();
      if (adapterVehicles.length === 0) {
        logger.warn("Adapter returned no vehicles, falling back to default data");
        return null;
      }
      logger.info(`Loaded ${adapterVehicles.length} vehicles from adapter`);
      return adapterVehicles;
    } catch (error) {
      logger.error(`Failed to load vehicles from adapter: ${error}`);
      logger.warn("Falling back to default vehicle data");
      return null;
    }
  }

  /**
   * Resets the vehicle manager to its initial state.
   * Performs async I/O first (adapter fetch), then atomically swaps in
   * the new vehicle set so concurrent readers never see empty state.
   *
   * @returns Promise that resolves when reset is complete
   */
  public async reset(): Promise<void> {
    // Phase 1: Async I/O — fetch adapter vehicles while old data stays live.
    // this.vehicles is NOT modified, so GET /vehicles still returns old data.
    const adapterVehicles = await this.fetchAdapterVehicles();

    // Phase 2: Synchronous swap — no await below this point, so no
    // event-loop yield. The map swap is atomic w.r.t. concurrent readers.
    this.clock.reset();
    this.vehicles = new Map();
    this.visitedEdges = new Map();
    this.routes = new Map();
    this.waypointRoutes = new Map();
    this.vehiclesByEdge = new Map();
    this.fleets.reset();

    if (adapterVehicles) {
      adapterVehicles.forEach((v) => {
        this.addVehicle(v.id, v.name, v.position);
      });
    } else {
      this.loadFromData();
    }

    // Clean up game loop and active vehicles
    this.stopGameLoop();
    this.activeVehicles.clear();
    this.lastUpdateTimes.clear();
    this.lastPathfindAttempt.clear();
    if (this.locationInterval) {
      clearInterval(this.locationInterval);
      this.locationInterval = null;
    }
  }

  /**
   * Creates a new vehicle with default or random edge start.
   * When seedPosition is provided, finds the nearest node and uses one of
   * its connected edges as the starting edge instead of a random one.
   */
  private addVehicle(id: string, name: string, seedPosition?: [number, number]): void {
    let startEdge: Edge;

    if (seedPosition) {
      const nearestNode = this.network.findNearestNode(seedPosition);
      if (nearestNode.connections.length > 0) {
        startEdge = nearestNode.connections[0];
      } else {
        startEdge = this.network.getRandomEdge();
      }
    } else {
      startEdge = this.network.getRandomEdge();
    }

    this.vehicles.set(id, {
      id,
      name,
      currentEdge: startEdge,
      position: startEdge.start.coordinates,
      speed: this.options.minSpeed,
      bearing: startEdge.bearing,
      progress: 0,
    });

    this.traffic.enter(startEdge.id);
    this.addToEdgeIndex(id, startEdge.id);
    const buffer = new CircularBuffer<string>(VEHICLE_CONSTANTS.MAX_VISITED_EDGES);
    buffer.add(startEdge.id);
    this.visitedEdges.set(id, buffer);
    this.setRandomDestination(id);
  }

  // ─── Edge spatial index management ─────────────────────────────────

  /**
   * Adds a vehicle to the edge spatial index.
   */
  private addToEdgeIndex(vehicleId: string, edgeId: string): void {
    let vehiclesOnEdge = this.vehiclesByEdge.get(edgeId);
    if (!vehiclesOnEdge) {
      vehiclesOnEdge = new Set();
      this.vehiclesByEdge.set(edgeId, vehiclesOnEdge);
    }
    vehiclesOnEdge.add(vehicleId);
  }

  /**
   * Removes a vehicle from the edge spatial index.
   */
  private removeFromEdgeIndex(vehicleId: string, edgeId: string): void {
    const vehiclesOnEdge = this.vehiclesByEdge.get(edgeId);
    if (vehiclesOnEdge) {
      vehiclesOnEdge.delete(vehicleId);
      if (vehiclesOnEdge.size === 0) {
        this.vehiclesByEdge.delete(edgeId);
      }
    }
  }

  /**
   * Moves a vehicle from one edge to another in the spatial index.
   */
  private moveInEdgeIndex(vehicleId: string, fromEdgeId: string, toEdgeId: string): void {
    this.removeFromEdgeIndex(vehicleId, fromEdgeId);
    this.addToEdgeIndex(vehicleId, toEdgeId);
  }

  private pickDestination(): Node {
    // 60% chance to pick a sector-normalized POI, 40% chance for a sector-normalized random node.
    // Both use sector-based selection so destinations are spread across the whole map.
    if (Math.random() < 0.6) {
      const poiNode = this.network.getRandomPOINode();
      if (poiNode) return poiNode;
    }
    return this.network.getRandomNode();
  }

  private setRandomDestination(vehicleId: string): void {
    const vehicle = this.vehicles.get(vehicleId);
    if (!vehicle) return;

    const destination = this.pickDestination();
    const startNode = vehicle.currentEdge.end;

    // Fire-and-forget async pathfinding via worker pool.
    // The vehicle continues random movement until the route resolves.
    this.network
      .findRouteAsync(startNode, destination)
      .then((route) => {
        // Vehicle may have been removed while we were pathfinding
        if (!this.vehicles.has(vehicleId)) return;

        if (route) {
          this.routes.set(vehicleId, route);
          // edgeIndex = -1: vehicle's currentEdge is not in the route.
          // When the current edge completes, getNextEdgeForVehicle returns route.edges[0].
          // route.edges[0].start === currentEdge.end, so the transition is seamless.
          vehicle.edgeIndex = -1;
          this.emit("direction", {
            vehicleId,
            route: utils.nonCircularRouteEdges(route),
            eta: utils.estimateRouteDuration(route, vehicle.speed),
          });
        }
      })
      .catch(() => {
        // Worker error — vehicle continues random movement, will retry later
      });
  }

  // ─── Game loop ─────────────────────────────────────────────────────

  /**
   * Starts the single game loop if not already running.
   * The loop iterates all active vehicles per tick.
   */
  private startGameLoop(intervalMs: number): void {
    this.gameLoopIntervalMs = intervalMs;
    if (this.gameLoopInterval) return; // already running

    this.gameLoopInterval = setInterval(() => this.gameLoopTick(), intervalMs);
  }

  /**
   * Stops the game loop.
   */
  private stopGameLoop(): void {
    if (this.gameLoopInterval) {
      clearInterval(this.gameLoopInterval);
      this.gameLoopInterval = null;
    }
  }

  /**
   * Restarts the game loop with a new interval, preserving active vehicles.
   */
  private restartGameLoop(intervalMs: number): void {
    this.stopGameLoop();
    if (this.activeVehicles.size > 0) {
      this.startGameLoop(intervalMs);
    }
  }

  /**
   * Single game loop tick: updates all active vehicles.
   */
  private gameLoopTick(): void {
    const now = Date.now();

    // Tick simulation clock once per game loop
    const clockDelta = now - this.lastClockTick;
    this.lastClockTick = now;
    this.clock.tick(clockDelta);

    for (const vehicleId of this.activeVehicles) {
      const vehicle = this.vehicles.get(vehicleId);
      if (!vehicle) continue;

      const lastUpdate = this.lastUpdateTimes.get(vehicleId) ?? now;
      const deltaMs = now - lastUpdate;
      this.lastUpdateTimes.set(vehicleId, now);

      this.updateVehicle(vehicle, deltaMs);

      this.emit(
        "update",
        serializeVehicle(vehicle, this.fleetManager.getVehicleFleetId(vehicleId))
      );
    }
  }

  /**
   * Starts periodic movement updates for a specific vehicle.
   * Registers the vehicle as active in the game loop.
   *
   * @param vehicleId - ID of the vehicle to start moving
   * @param intervalMs - Update interval in milliseconds
   *
   * @example
   * vehicleManager.startVehicleMovement('vehicle-1', 500);
   */
  public startVehicleMovement(vehicleId: string, intervalMs: number): void {
    this.lastUpdateTimes.set(vehicleId, Date.now());
    this.activeVehicles.add(vehicleId);

    // Start or restart the game loop if needed
    if (!this.gameLoopInterval) {
      this.startGameLoop(intervalMs);
    } else if (intervalMs !== this.gameLoopIntervalMs) {
      this.restartGameLoop(intervalMs);
    }
  }

  /**
   * Stops movement updates for a specific vehicle.
   * Removes from the active set. Stops the game loop if no vehicles remain.
   *
   * @param vehicleId - ID of the vehicle to stop
   *
   * @example
   * vehicleManager.stopVehicleMovement('vehicle-1');
   */
  public stopVehicleMovement(vehicleId: string): void {
    this.activeVehicles.delete(vehicleId);

    // Stop the game loop when no vehicles are active
    if (this.activeVehicles.size === 0) {
      this.stopGameLoop();
    }
  }

  /**
   * Starts periodic synchronization of vehicle locations to external adapter.
   *
   * @param intervalMs - Synchronization interval in milliseconds
   *
   * @example
   * vehicleManager.startLocationUpdates(5000); // Sync every 5 seconds
   */
  public startLocationUpdates(intervalMs: number): void {
    if (this.locationInterval) {
      clearInterval(this.locationInterval);
    }
    this.locationInterval = setInterval(async () => {
      try {
        const vehicles = Array.from(this.vehicles.values());
        await this.adapter.sync({
          vehicles: vehicles.map((v) => ({
            id: v.id,
            name: v.name,
            latitude: v.position[0],
            longitude: v.position[1],
          })),
          timestamp: Date.now(),
        });
      } catch (error) {
        logger.error(`Failed to sync vehicles to adapter: ${error}`);
      }
    }, intervalMs);
  }

  /**
   * Stops periodic synchronization of vehicle locations to external adapter.
   * Clears the location update interval.
   */
  public stopLocationUpdates(): void {
    if (this.locationInterval) {
      clearInterval(this.locationInterval);
      this.locationInterval = null;
    }
  }

  /**
   * Updates vehicle manager configuration options.
   * Emits 'options' event after applying changes.
   *
   * @param options - Partial options to merge with existing configuration
   *
   * @example
   * vehicleManager.setOptions({ maxSpeed: 80, heatZoneSpeedFactor: 0.6 });
   */
  public setOptions(options: Partial<StartOptions>): void {
    const prevInterval = this.options.updateInterval;
    this.options = { ...this.options, ...options };

    // Restart game loop if updateInterval changed and vehicles are running
    if (
      options.updateInterval &&
      options.updateInterval !== prevInterval &&
      this.activeVehicles.size > 0
    ) {
      this.restartGameLoop(options.updateInterval);
    }

    this.emit("options", this.options);
  }

  /**
   * Gets the current vehicle manager configuration options.
   *
   * @returns Current configuration including speeds, intervals, and adapter settings
   */
  public getOptions(): StartOptions {
    return this.options;
  }

  private updateVehicle(vehicle: Vehicle, deltaMs: number): void {
    // If dwelling at destination, check if dwell period is over
    if (vehicle.dwellUntil) {
      if (Date.now() < vehicle.dwellUntil) return; // still dwelling
      vehicle.dwellUntil = undefined;
      this.setRandomDestination(vehicle.id);
      return;
    }

    const route = this.routes.get(vehicle.id);
    this.updateSpeed(vehicle, deltaMs);

    if (!route || route.edges.length === 0) {
      this.updatePosition(vehicle, deltaMs);
      const now = Date.now();
      const lastAttempt = this.lastPathfindAttempt.get(vehicle.id) ?? 0;
      if (now - lastAttempt > VehicleManager.PATHFIND_COOLDOWN) {
        this.lastPathfindAttempt.set(vehicle.id, now);
        this.setRandomDestination(vehicle.id);
      }
    } else {
      this.updatePositionOnRoute(vehicle, route, deltaMs);
    }
  }

  private updateSpeed(vehicle: Vehicle, deltaMs: number): void {
    const edgeMaxSpeed = vehicle.currentEdge.maxSpeed;

    // Time-based speed adjustment: night bonus on highways, no change otherwise
    const hour = this.clock.getHour();
    const isHighway = vehicle.currentEdge.highway === "trunk" || vehicle.currentEdge.highway === "primary";
    const timeSpeedModifier = (hour >= 22 || hour < 5) && isHighway ? 1.1 : 1.0;
    const adjustedEdgeMaxSpeed = edgeMaxSpeed * timeSpeedModifier;

    const isInHeatZone = this.network.isPositionInHeatZone(vehicle.position);
    const speedFactor = isInHeatZone ? this.options.heatZoneSpeedFactor : 1;
    const congestion = this.traffic.getCongestionFactor(
      vehicle.currentEdge.id,
      vehicle.currentEdge.distance,
      vehicle.currentEdge.highway
    );
    const effectiveMax = Math.min(this.options.maxSpeed, adjustedEdgeMaxSpeed) * speedFactor * congestion;

    // Refresh target speed occasionally (roughly every 5 seconds)
    if (!vehicle.targetSpeed || Math.random() < deltaMs / 5000) {
      const variation = 1 + (Math.random() * 2 - 1) * this.options.speedVariation;
      vehicle.targetSpeed = Math.min(
        effectiveMax,
        Math.max(this.options.minSpeed, effectiveMax * variation)
      );
    }

    // Check for upcoming turn (peek without side effects)
    const nextEdge = this.peekNextEdge(vehicle);
    if (nextEdge) {
      const rawDiff = Math.abs(nextEdge.bearing - vehicle.bearing);
      const bearingDiff = rawDiff > 180 ? 360 - rawDiff : rawDiff;
      if (bearingDiff > this.options.turnThreshold) {
        // Scale deceleration by turn sharpness
        const sharpness = Math.min(bearingDiff / 180, 1);
        vehicle.targetSpeed = Math.max(this.options.minSpeed, effectiveMax * (1 - sharpness * 0.6));
      }
    }

    // Task 3: Following distance using single-pass findVehicleAhead
    const ahead = this.findVehicleAhead(vehicle);

    if (ahead) {
      const gap = (ahead.progress - vehicle.progress) * vehicle.currentEdge.distance;
      const MIN_GAP_KM = 0.02; // 20 meters
      if (gap < MIN_GAP_KM) {
        vehicle.targetSpeed = Math.min(vehicle.targetSpeed, ahead.speed * 0.9);
      }
    }

    // Smoothly interpolate toward target (accel/decel rates are in km/h per second)
    const deltaSec = deltaMs / 1000;
    const accelRate =
      vehicle.speed < vehicle.targetSpeed ? this.options.acceleration : this.options.deceleration;
    const diff = vehicle.targetSpeed - vehicle.speed;
    const maxChange = accelRate * deltaSec;
    vehicle.speed = vehicle.speed + Math.sign(diff) * Math.min(Math.abs(diff), maxChange);
    vehicle.speed = Math.min(effectiveMax, Math.max(this.options.minSpeed, vehicle.speed));
  }

  /**
   * Task 3: Single-pass search for the nearest vehicle ahead on the same edge.
   * Uses the edge spatial index (Task 2) and avoids creating intermediate arrays.
   *
   * @returns The vehicle with the smallest progress > current vehicle's progress, or undefined
   */
  private findVehicleAhead(vehicle: Vehicle): Vehicle | undefined {
    const edgeId = vehicle.currentEdge.id;
    const vehicleIdsOnEdge = this.vehiclesByEdge.get(edgeId);
    if (!vehicleIdsOnEdge) return undefined;

    let closestAhead: Vehicle | undefined;
    let closestProgress = Infinity;

    for (const id of vehicleIdsOnEdge) {
      if (id === vehicle.id) continue;
      const other = this.vehicles.get(id);
      if (!other) continue;
      if (other.progress > vehicle.progress && other.progress < closestProgress) {
        closestProgress = other.progress;
        closestAhead = other;
      }
    }

    return closestAhead;
  }

  /**
   * Side-effect-free lookahead for speed calculations.
   * Does NOT modify visitedEdges — use getNextEdge for actual movement.
   */
  private peekNextEdge(vehicle: Vehicle): Edge {
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

  private getNextEdge(vehicle: Vehicle): Edge {
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
    const vehicleVisitedEdges = this.visitedEdges.get(vehicle.id);
    const unvisitedEdges = possibleEdges.filter((e) => !vehicleVisitedEdges?.has(e.id));
    if (unvisitedEdges.length > 0) {
      const nextEdge = unvisitedEdges[Math.floor(Math.random() * unvisitedEdges.length)];
      vehicleVisitedEdges?.add(nextEdge.id);
      return nextEdge;
    }
    return possibleEdges[Math.floor(Math.random() * possibleEdges.length)];
  }

  /**
   * Unified position update logic for both random and route-based movement.
   */
  private updatePositionCore(vehicle: Vehicle, deltaMs: number, route?: Route): void {
    let remainingDistance = (vehicle.speed / 3600) * (deltaMs / 1000);

    while (remainingDistance > 0) {
      const edgeRemaining = (1 - vehicle.progress) * vehicle.currentEdge.distance;

      if (remainingDistance >= edgeRemaining) {
        // Completed current edge
        vehicle.progress = 1;
        remainingDistance -= edgeRemaining;

        this.updateVehiclePositionAndBearing(vehicle);

        // Get next edge based on mode (random or route-based)
        const nextEdgeResult = this.getNextEdgeForVehicle(vehicle, route);
        if (!nextEdgeResult) {
          // Vehicle stays "on" current edge during dwell — traffic.leave
          // happens when it transitions to the next route's first edge.
          return;
        }

        const previousEdgeId = vehicle.currentEdge.id;
        this.traffic.leave(previousEdgeId);
        vehicle.currentEdge = nextEdgeResult.edge;
        this.traffic.enter(nextEdgeResult.edge.id);
        this.moveInEdgeIndex(vehicle.id, previousEdgeId, nextEdgeResult.edge.id);
        vehicle.progress = 0;
        if (nextEdgeResult.edgeIndex !== undefined) {
          vehicle.edgeIndex = nextEdgeResult.edgeIndex;
        }
      } else {
        // Still on current edge
        vehicle.progress += remainingDistance / vehicle.currentEdge.distance;
        remainingDistance = 0;

        this.updateVehiclePositionAndBearing(vehicle);
      }
    }
  }

  /**
   * Update vehicle position and bearing based on current edge and progress.
   */
  private updateVehiclePositionAndBearing(vehicle: Vehicle): void {
    vehicle.position = utils.interpolatePosition(
      vehicle.currentEdge.start.coordinates,
      vehicle.currentEdge.end.coordinates,
      vehicle.progress
    );
    vehicle.bearing = vehicle.currentEdge.bearing;
  }

  /**
   * Get next edge for vehicle, either from route or random selection.
   */
  private getNextEdgeForVehicle(
    vehicle: Vehicle,
    route?: Route
  ): { edge: Edge; edgeIndex?: number } | null {
    if (route) {
      // Route-based movement
      const edgeIndex =
        vehicle.edgeIndex ?? route.edges.findIndex((e) => e.id === vehicle.currentEdge.id);

      if (edgeIndex < route.edges.length - 1) {
        return {
          edge: route.edges[edgeIndex + 1],
          edgeIndex: edgeIndex + 1,
        };
      } else {
        // Reached end of current route segment
        return this.handleRouteCompleted(vehicle);
      }
    } else {
      // Random movement
      const nextEdge = this.getNextEdge(vehicle);
      return { edge: nextEdge };
    }
  }

  /**
   * Handles when a vehicle completes its current route segment.
   * For multi-stop routes, advances to the next waypoint leg.
   * For single-destination routes, dwells and picks a new random destination.
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
        // More waypoints — dwell at this waypoint, then start next leg
        const dwellSeconds = waypoint?.dwellTime ?? 10 + Math.random() * 50;
        vehicle.dwellUntil = Date.now() + dwellSeconds * 1000;
        vehicle.speed = this.options.minSpeed;

        // Set up the next leg route so updateVehicle picks it up after dwell
        const nextLeg = multiRoute.legs[wpIndex + 1];
        if (nextLeg) {
          this.routes.set(vehicle.id, { edges: nextLeg.edges, distance: nextLeg.distance });
          vehicle.currentWaypointIndex = wpIndex + 1;
          vehicle.edgeIndex = -1;
        }
        return null;
      } else {
        // Final waypoint reached
        this.emit("route:completed", { vehicleId: vehicle.id });
        this.clearWaypointState(vehicle);
        const dwellSeconds = waypoint?.dwellTime ?? 10 + Math.random() * 50;
        vehicle.dwellUntil = Date.now() + dwellSeconds * 1000;
        vehicle.speed = this.options.minSpeed;
        this.routes.delete(vehicle.id);
        return null;
      }
    }

    // Single-destination route: dwell before picking new route
    const dwellSeconds = 10 + Math.random() * 50;
    vehicle.dwellUntil = Date.now() + dwellSeconds * 1000;
    vehicle.speed = this.options.minSpeed;
    this.routes.delete(vehicle.id);
    return null;
  }

  /**
   * Clears all waypoint-related state for a vehicle.
   */
  private clearWaypointState(vehicle: Vehicle): void {
    vehicle.waypoints = undefined;
    vehicle.currentWaypointIndex = undefined;
    this.waypointRoutes.delete(vehicle.id);
  }

  /**
   * Random movement update.
   */
  private updatePosition(vehicle: Vehicle, deltaMs: number): void {
    this.updatePositionCore(vehicle, deltaMs);
  }

  /**
   * Route-based movement update.
   */
  private updatePositionOnRoute(vehicle: Vehicle, route: Route, deltaMs: number): void {
    this.updatePositionCore(vehicle, deltaMs, route);
  }

  /**
   * Calculates and sets a route from a vehicle's current position to a destination.
   * Uses A* pathfinding to find the shortest path on the road network.
   * Emits 'direction' event with the calculated route and ETA.
   *
   * @param vehicleId - ID of the vehicle to route
   * @param destination - Destination coordinates as [latitude, longitude]
   * @returns Promise that resolves when route is calculated and set
   * @throws {Error} If vehicle is not found
   *
   * @example
   * await vehicleManager.findAndSetRoutes('vehicle-1', [45.5017, -73.5673]);
   */
  public async findAndSetRoutes(
    vehicleId: string,
    destination: [number, number]
  ): Promise<DirectionResult> {
    const vehicle = this.vehicles.get(vehicleId);
    if (!vehicle) {
      return { vehicleId, status: "error", error: `Vehicle ${vehicleId} not found` };
    }

    const endNode = this.network.findNearestNode(destination);
    const startNode = this.network.findNearestNode(vehicle.position);

    if (startNode.connections.length === 0 || endNode.connections.length === 0) {
      logger.error("Start/end node has no connections");
      return {
        vehicleId,
        status: "error",
        error: "Start or end node has no connections",
        snappedTo: endNode.coordinates,
      };
    }

    const route = await this.network.findRouteAsync(startNode, endNode);
    if (!route || route.edges.length === 0) {
      logger.error("No route found to destination");
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
    this.moveInEdgeIndex(vehicleId, previousEdgeId, vehicle.currentEdge.id);
    vehicle.progress = 0;
    vehicle.edgeIndex = 0; // Initialize cached edge index

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

  /**
   * Calculates and sets a multi-stop route through waypoints.
   * Computes A* routes between consecutive waypoints (current position → wp1 → wp2 → ...).
   * Emits 'direction' event with the full stitched route and waypoint metadata.
   */
  public async findAndSetWaypointRoutes(
    vehicleId: string,
    waypoints: Waypoint[]
  ): Promise<DirectionResult> {
    const vehicle = this.vehicles.get(vehicleId);
    if (!vehicle) {
      return { vehicleId, status: "error", error: `Vehicle ${vehicleId} not found` };
    }

    if (waypoints.length === 0) {
      return { vehicleId, status: "error", error: "No waypoints provided" };
    }

    // Build ordered positions: [current position, wp1, wp2, ...]
    const positions: [number, number][] = [vehicle.position, ...waypoints.map((wp) => wp.position)];
    const legs: { edges: Edge[]; distance: number; waypointIndex: number }[] = [];
    const legResults: { start: [number, number]; end: [number, number]; distance: number }[] = [];

    // Compute A* for each consecutive pair
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

      const route = await this.network.findRouteAsync(startNode, endNode);
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

    // Store multi-stop route state
    const multiRoute: MultiStopRoute = { legs, totalDistance };
    this.waypointRoutes.set(vehicleId, multiRoute);

    // Set waypoint state on vehicle
    vehicle.waypoints = waypoints;
    vehicle.currentWaypointIndex = 0;

    // Set the first leg as the active route
    const firstLeg = legs[0];
    const stitchedRoute: Route = { edges: allEdges, distance: totalDistance };
    this.routes.set(vehicleId, { edges: firstLeg.edges, distance: firstLeg.distance });

    // Snap vehicle to start of first leg
    const previousEdgeId = vehicle.currentEdge.id;
    this.traffic.leave(previousEdgeId);
    vehicle.currentEdge = firstLeg.edges[0];
    this.traffic.enter(vehicle.currentEdge.id);
    this.moveInEdgeIndex(vehicleId, previousEdgeId, vehicle.currentEdge.id);
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

  public assignVehicleToFleet(vehicleId: string, fleetId: string): boolean {
    const vehicle = this.vehicles.get(vehicleId);
    if (!vehicle) return false;
    try {
      this.fleets.assignVehicles(fleetId, [vehicleId]);
      vehicle.fleetId = fleetId;
      this.emit("update", serializeVehicle(vehicle));
      return true;
    } catch {
      return false;
    }
  }

  public unassignVehicleFromFleet(vehicleId: string): boolean {
    const vehicle = this.vehicles.get(vehicleId);
    if (!vehicle) return false;
    const fleetId = this.fleets.getVehicleFleetId(vehicleId);
    if (!fleetId) return false;
    try {
      this.fleets.unassignVehicles(fleetId, [vehicleId]);
      vehicle.fleetId = undefined;
      this.emit("update", serializeVehicle(vehicle));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Checks if a vehicle with the given ID exists.
   *
   * @param vehicleId - ID of the vehicle to check
   * @returns True if the vehicle exists, false otherwise
   */
  public hasVehicle(vehicleId: string): boolean {
    return this.vehicles.has(vehicleId);
  }

  public getVehicles(): VehicleDTO[] {
    return Array.from(this.vehicles.values()).map((v) =>
      serializeVehicle(v, this.fleetManager.getVehicleFleetId(v.id))
    );
  }

  /**
   * Gets all active vehicle routes with their destinations and ETAs.
   *
   * @returns Array of direction objects containing vehicle ID, route, and estimated time of arrival
   *
   * @example
   * const directions = vehicleManager.getDirections();
   * console.log(`${directions.length} vehicles have active routes`);
   */
  public getDirections(): Direction[] {
    return Array.from(this.routes.entries()).map(([id, route]) => {
      const vehicle = this.vehicles.get(id)!;
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

  /**
   * Checks if any vehicles are currently running.
   *
   * @returns True if at least one vehicle has an active movement update, false otherwise
   */
  public isRunning(): boolean {
    return this.activeVehicles.size > 0;
  }

  // ─── Incident rerouting ──────────────────────────────────────────

  /**
   * Reroutes vehicles whose active route is affected by a newly created incident.
   * Only checks edges AHEAD of each vehicle's current position (edgeIndex).
   * Pathfinding is async — the vehicle continues moving on its current edge
   * while the new route is computed.
   */
  public handleIncidentCreated(incident: Incident): void {
    const affectedEdgeIds = new Set(incident.edgeIds);

    for (const [vehicleId, route] of this.routes) {
      const vehicle = this.vehicles.get(vehicleId);
      if (!vehicle) continue;

      const currentIdx = vehicle.edgeIndex ?? 0;

      // Check if any edge AHEAD of the vehicle's current position is affected
      const hasOverlap = route.edges.some(
        (edge, idx) => idx > currentIdx && affectedEdgeIds.has(edge.id)
      );

      if (!hasOverlap) continue;

      // Determine start and end nodes for rerouting
      const startNode = vehicle.currentEdge.end;
      const lastEdge = route.edges[route.edges.length - 1];
      const destinationNode = lastEdge.end;

      this.network
        .findRouteAsync(startNode, destinationNode)
        .then((newRoute) => {
          // Vehicle may have been removed or route cleared while pathfinding
          if (!this.vehicles.has(vehicleId)) return;
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
        .catch(() => {
          // Worker error — vehicle continues on current route
        });
    }
  }

  /**
   * Placeholder for future incident-cleared handling.
   * Could be used to reroute vehicles back to optimal paths
   * once an incident is resolved.
   */
  public handleIncidentCleared(_incidentId: string): void {
    // noop — reserved for future use
  }

  /**
   * Gets the road network instance used by the vehicle manager.
   *
   * @returns RoadNetwork instance containing nodes, edges, and pathfinding methods
   */
  public getNetwork(): RoadNetwork {
    return this.network;
  }

  public getTrafficProfile(): TrafficProfile {
    return this.traffic.getProfile();
  }

  public setTrafficProfile(profile: TrafficProfile): void {
    this.traffic.setProfile(profile);
  }
}
