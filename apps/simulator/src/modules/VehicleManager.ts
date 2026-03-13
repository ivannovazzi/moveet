import type {
  Vehicle,
  DataVehicle,
  Edge,
  Node,
  VehicleDTO,
  Route,
  Direction,
  StartOptions,
} from "../types";
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
  private locationInterval: NodeJS.Timeout | null = null;
  private lastUpdateTimes: Map<string, number> = new Map();
  private lastPathfindAttempt: Map<string, number> = new Map();
  private static readonly PATHFIND_COOLDOWN = 3000;
  private adapter = new Adapter();
  private traffic = new TrafficManager();
  public readonly fleets = new FleetManager();

  // Task 1: Single game loop instead of per-vehicle setInterval
  private activeVehicles: Set<string> = new Set();
  private gameLoopInterval: NodeJS.Timeout | null = null;
  private gameLoopIntervalMs: number = config.updateInterval;

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
    this.fleetManager.reset();
    this.vehicles = new Map();
    this.visitedEdges = new Map();
    this.routes = new Map();
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
    const isInHeatZone = this.network.isPositionInHeatZone(vehicle.position);
    const speedFactor = isInHeatZone ? this.options.heatZoneSpeedFactor : 1;
    const congestion = this.traffic.getCongestionFactor(
      vehicle.currentEdge.id,
      vehicle.currentEdge.distance
    );
    const effectiveMax = Math.min(this.options.maxSpeed, edgeMaxSpeed) * speedFactor * congestion;

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
        // Reached destination — dwell before picking new route
        const dwellSeconds = 10 + Math.random() * 50; // 10-60 seconds
        vehicle.dwellUntil = Date.now() + dwellSeconds * 1000;
        vehicle.speed = this.options.minSpeed;
        this.routes.delete(vehicle.id);
        return null;
      }
    } else {
      // Random movement
      const nextEdge = this.getNextEdge(vehicle);
      return { edge: nextEdge };
    }
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
  public async findAndSetRoutes(vehicleId: string, destination: [number, number]): Promise<void> {
    const vehicle = this.vehicles.get(vehicleId);
    if (!vehicle) throw new Error(`Vehicle ${vehicleId} not found`);

    const endNode = this.network.findNearestNode(destination);
    const startNode = this.network.findNearestNode(vehicle.position);

    if (startNode.connections.length === 0 || endNode.connections.length === 0) {
      logger.error("Start/end node has no connections");
      return;
    }

    const route = await this.network.findRouteAsync(startNode, endNode);
    if (!route) {
      logger.error("No route found to destination");
      return;
    }

    this.emit("direction", {
      vehicleId,
      route: utils.nonCircularRouteEdges(route),
      eta: utils.estimateRouteDuration(route, vehicle.speed),
    });
    this.routes.set(vehicleId, route);
    const previousEdgeId = vehicle.currentEdge.id;
    this.traffic.leave(previousEdgeId);
    vehicle.currentEdge = route.edges[0];
    this.traffic.enter(vehicle.currentEdge.id);
    this.moveInEdgeIndex(vehicleId, previousEdgeId, vehicle.currentEdge.id);
    vehicle.progress = 0;
    vehicle.edgeIndex = 0; // Initialize cached edge index
  }

  /**
   * Gets all vehicles with their current state as DTOs for external consumption.
   * Converts internal vehicle representation to simplified transfer objects.
   *
   * @returns Array of vehicle DTOs containing position, speed, and heading
   *
   * @example
   * const vehicles = vehicleManager.getVehicles();
   * vehicles.forEach(v => console.log(`${v.name}: ${v.speed}km/h at [${v.position}]`));
   */
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
    return Array.from(this.routes.entries()).map(([id, route]) => ({
      vehicleId: id,
      route: utils.nonCircularRouteEdges(route),
      eta: utils.estimateRouteDuration(route, this.vehicles.get(id)!.speed),
    }));
  }

  /**
   * Checks if any vehicles are currently running.
   *
   * @returns True if at least one vehicle has an active movement update, false otherwise
   */
  public isRunning(): boolean {
    return this.activeVehicles.size > 0;
  }

  /**
   * Gets the road network instance used by the vehicle manager.
   *
   * @returns RoadNetwork instance containing nodes, edges, and pathfinding methods
   */
  public getNetwork(): RoadNetwork {
    return this.network;
  }
}
