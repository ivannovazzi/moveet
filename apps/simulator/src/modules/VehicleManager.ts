import type {
  Vehicle,
  Edge,
  Incident,
  VehicleDTO,
  Route,
  Direction,
  DirectionResult,
  StartOptions,
  Waypoint,
  MultiStopRoute,
  TrafficProfile,
  VehicleType,
} from "../types";
import { SimulationClock } from "./SimulationClock";
import type { RoadNetwork } from "./RoadNetwork";
import { config } from "../utils/config";
import { EventEmitter } from "events";
import { serializeVehicle } from "../utils/serializer";
import { TrafficManager } from "./TrafficManager";
import { FleetManager } from "./FleetManager";
import { VEHICLE_PROFILES } from "../utils/vehicleProfiles";
import { VehicleRegistry } from "./VehicleRegistry";
import { RouteManager } from "./RouteManager";
import { GameLoop } from "./GameLoop";
import { AdapterSyncManager } from "./AdapterSyncManager";
import { AnalyticsAccumulator } from "./AnalyticsAccumulator";

/**
 * Thin facade/coordinator that delegates to focused sub-managers:
 * - VehicleRegistry: vehicle state (add/remove/get/update vehicles, edge spatial index)
 * - RouteManager: route/waypoint tracking, pathfinding, movement physics
 * - GameLoop: tick/timing logic
 * - AdapterSyncManager: adapter integration
 *
 * Maintains the same public API as the original monolithic class for backward compatibility.
 */
export class VehicleManager extends EventEmitter {
  // ─── Sub-managers ─────────────────────────────────────────────────
  public readonly registry: VehicleRegistry;
  public readonly routeManager: RouteManager;
  public readonly gameLoop: GameLoop;
  public readonly adapterSync: AdapterSyncManager;
  public readonly analytics: AnalyticsAccumulator;

  public readonly clock = new SimulationClock({ startHour: 7, speedMultiplier: 1 });
  private traffic = new TrafficManager(this.clock);
  public readonly fleets = new FleetManager();

  private pendingVehicleTypes?: Partial<Record<VehicleType, number>>;

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
    fleetManager: FleetManager
  ) {
    super();

    // Initialize sub-managers
    this.registry = new VehicleRegistry(network, fleetManager);
    this.routeManager = new RouteManager(network, this.registry, this.traffic);
    this.gameLoop = new GameLoop(
      this.registry,
      (vehicle, deltaMs) => this.updateVehicle(vehicle, deltaMs),
      fleetManager,
      this.clock
    );
    this.adapterSync = new AdapterSyncManager();
    this.analytics = new AnalyticsAccumulator(this.registry, fleetManager);

    // Attach analytics accumulator to game loop so stats update each tick
    this.gameLoop.analyticsAccumulator = this.analytics;

    // Wire clock hour to RouteManager for speed calculations
    this.routeManager.getClockHour = () => this.clock.getHour();

    // Forward events from sub-managers to this facade
    this.routeManager.on("direction", (data) => {
      this.emit("direction", data);
      // Track optimal distance when a route is set
      if (data.route?.distance != null) {
        this.analytics.onDirectionSet(data.vehicleId, data.route.distance);
      }
    });
    this.routeManager.on("waypoint:reached", (data) => {
      this.emit("waypoint:reached", data);
      this.analytics.onWaypointReached(data.vehicleId);
    });
    this.routeManager.on("route:completed", (data) => this.emit("route:completed", data));
    this.routeManager.on("vehicle:rerouted", (data) => this.emit("vehicle:rerouted", data));
    this.gameLoop.on("update", (data) => this.emit("update", data));

    this.init();
  }

  // ─── Backward-compatible private field accessors ──────────────────
  // These getters/methods exist so that existing tests using (manager as any).fieldName
  // continue to work after the refactor. TypeScript flags them as unused because
  // they are only accessed dynamically from test code. We suppress with @ts-expect-error.

  // @ts-expect-error TS6133 - accessed dynamically by tests
  private get vehicles(): Map<string, Vehicle> {
    return this.registry.getAll();
  }
  // @ts-expect-error TS6133
  private get visitedEdges() {
    return (this.registry as any).visitedEdges;
  }
  // @ts-expect-error TS6133
  private get routes(): Map<string, Route> {
    return (this.routeManager as any).routes;
  }
  // @ts-expect-error TS6133
  private get waypointRoutes(): Map<string, MultiStopRoute> {
    return (this.routeManager as any).waypointRoutes;
  }
  // @ts-expect-error TS6133
  private get activeVehicles(): Set<string> {
    return this.gameLoop.getActiveVehicles();
  }
  // @ts-expect-error TS6133
  private get gameLoopInterval(): NodeJS.Timeout | null {
    return this.gameLoop.getGameLoopIntervalRef();
  }
  // @ts-expect-error TS6133
  private get gameLoopIntervalMs(): number {
    return this.gameLoop.getGameLoopIntervalMs();
  }
  // @ts-expect-error TS6133
  private get lastUpdateTimes(): Map<string, number> {
    return this.gameLoop.getLastUpdateTimes();
  }
  // @ts-expect-error TS6133
  private get vehiclesByEdge(): Map<string, Set<string>> {
    return this.registry.getVehiclesByEdge();
  }
  // @ts-expect-error TS6133
  private get lastPathfindAttempt(): Map<string, number> {
    return (this.routeManager as any).lastPathfindAttempt;
  }

  // ─── Initialization ───────────────────────────────────────────────

  private init(): void {
    if (!config.adapterURL) {
      this.loadFromData(this.pendingVehicleTypes);
    }
  }

  public async initFromAdapter(): Promise<void> {
    await this.adapterSync.initFromAdapter(
      (id, name, position) => {
        this.addVehicle(id, name, position);
      },
      () => this.loadFromData()
    );
  }

  private loadFromData(vehicleTypes?: Partial<Record<VehicleType, number>>): void {
    // Priority: explicit vehicleTypes > env VEHICLE_TYPES > weighted default
    const types = vehicleTypes ?? config.vehicleTypes;
    this.registry.loadFromData(
      types as Partial<Record<VehicleType, number>> | undefined,
      (vehicleId) => {
        // After a vehicle is added to the registry, register traffic and set destination
        const vehicle = this.registry.get(vehicleId)!;
        this.traffic.enter(vehicle.currentEdge.id);
        this.setRandomDestination(vehicleId);
      }
    );
  }

  private addVehicle(
    id: string,
    name: string,
    seedPosition?: [number, number],
    vehicleType: VehicleType = "car"
  ): void {
    this.registry.addVehicle(id, name, seedPosition, vehicleType, (vehicleId) => {
      const vehicle = this.registry.get(vehicleId)!;
      this.traffic.enter(vehicle.currentEdge.id);
      this.setRandomDestination(vehicleId);
    });
  }

  // ─── Reset ────────────────────────────────────────────────────────

  public async reset(): Promise<void> {
    const adapterVehicles = await this.adapterSync.fetchAdapterVehicles();

    this.clock.reset();
    this.registry.reset();
    this.routeManager.reset();
    this.fleets.reset();
    this.analytics.resetStats();

    if (adapterVehicles) {
      adapterVehicles.forEach((v) => {
        this.addVehicle(v.id, v.name, v.position);
      });
    } else {
      this.loadFromData(this.pendingVehicleTypes);
    }

    this.gameLoop.reset();
    this.adapterSync.stopLocationUpdates();
  }

  // ─── Game loop delegation ─────────────────────────────────────────

  public startVehicleMovement(vehicleId: string, intervalMs: number): void {
    this.gameLoop.startVehicleMovement(vehicleId, intervalMs);
  }

  public stopVehicleMovement(vehicleId: string): void {
    this.gameLoop.stopVehicleMovement(vehicleId);
  }

  public isRunning(): boolean {
    return this.gameLoop.isRunning();
  }

  // ─── Adapter sync delegation ──────────────────────────────────────

  public startLocationUpdates(intervalMs: number): void {
    this.adapterSync.startLocationUpdates(intervalMs, () => this.registry.getAll().values());
  }

  public stopLocationUpdates(): void {
    this.adapterSync.stopLocationUpdates();
  }

  // ─── Options ──────────────────────────────────────────────────────

  public setOptions(
    options: Partial<StartOptions & { vehicleTypes?: Partial<Record<VehicleType, number>> }>
  ): void {
    const { vehicleTypes, ...startOptions } = options;
    if (vehicleTypes) {
      this.pendingVehicleTypes = vehicleTypes;
    }
    const prevInterval = this.options.updateInterval;
    this.options = { ...this.options, ...startOptions };

    if (
      startOptions.updateInterval &&
      startOptions.updateInterval !== prevInterval &&
      this.gameLoop.getActiveVehicles().size > 0
    ) {
      this.gameLoop.restartGameLoop(startOptions.updateInterval);
    }

    this.gameLoop.setGameLoopIntervalMs(this.options.updateInterval);
    this.emit("options", this.options);
  }

  public getOptions(): StartOptions {
    return this.options;
  }

  public getVehicleProfiles() {
    return VEHICLE_PROFILES;
  }

  // ─── Vehicle queries (facade) ─────────────────────────────────────

  public hasVehicle(vehicleId: string): boolean {
    return this.registry.has(vehicleId);
  }

  public getVehicles(): VehicleDTO[] {
    return this.registry.getAllSerialized();
  }

  public getDirections(): Direction[] {
    return this.routeManager.getDirections();
  }

  // ─── Route delegation ─────────────────────────────────────────────

  public async findAndSetRoutes(
    vehicleId: string,
    destination: [number, number]
  ): Promise<DirectionResult> {
    return this.routeManager.findAndSetRoutes(vehicleId, destination);
  }

  public async findAndSetWaypointRoutes(
    vehicleId: string,
    waypoints: Waypoint[]
  ): Promise<DirectionResult> {
    return this.routeManager.findAndSetWaypointRoutes(vehicleId, waypoints);
  }

  // ─── Fleet assignment ─────────────────────────────────────────────

  public assignVehicleToFleet(vehicleId: string, fleetId: string): boolean {
    const vehicle = this.registry.get(vehicleId);
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
    const vehicle = this.registry.get(vehicleId);
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

  // ─── Incident delegation ──────────────────────────────────────────

  public handleIncidentCreated(incident: Incident): void {
    this.routeManager.handleIncidentCreated(incident);
  }

  public handleIncidentCleared(_incidentId: string): void {
    this.routeManager.handleIncidentCleared(_incidentId);
  }

  // ─── Network & Traffic ────────────────────────────────────────────

  public getNetwork(): RoadNetwork {
    return this.network;
  }

  public getTrafficProfile(): TrafficProfile {
    return this.traffic.getProfile();
  }

  public setTrafficProfile(profile: TrafficProfile): void {
    this.traffic.setProfile(profile);
  }

  public getTrafficSnapshot() {
    return this.traffic.getTrafficSnapshot((id) => this.network.getEdge(id));
  }

  // ─── Backward-compatible private method proxies ───────────────────
  // Tests access these via (manager as any).methodName(...).
  // ts-expect-error blocks below suppress TS6133 "declared but never read" warnings.

  private setRandomDestination(vehicleId: string): void {
    this.routeManager.setRandomDestination(vehicleId);
  }

  private updateVehicle(vehicle: Vehicle, deltaMs: number): void {
    this.routeManager.updateVehicle(vehicle, deltaMs, this.options);
  }

  // @ts-expect-error TS6133
  private updateSpeed(vehicle: Vehicle, deltaMs: number): void {
    this.routeManager.updateSpeed(vehicle, deltaMs, this.options);
  }

  // @ts-expect-error TS6133
  private gameLoopTick(): void {
    this.gameLoop.gameLoopTick();
  }
  // @ts-expect-error TS6133
  private startGameLoop(intervalMs: number): void {
    this.gameLoop.startGameLoop(intervalMs);
  }
  // @ts-expect-error TS6133
  private stopGameLoop(): void {
    this.gameLoop.stopGameLoop();
  }
  // @ts-expect-error TS6133
  private restartGameLoop(intervalMs: number): void {
    this.gameLoop.restartGameLoop(intervalMs);
  }
  // @ts-expect-error TS6133
  private findVehicleAhead(vehicle: Vehicle): Vehicle | undefined {
    return this.registry.findVehicleAhead(vehicle);
  }
  // @ts-expect-error TS6133
  private addToEdgeIndex(vehicleId: string, edgeId: string): void {
    this.registry.addToEdgeIndex(vehicleId, edgeId);
  }
  // @ts-expect-error TS6133
  private removeFromEdgeIndex(vehicleId: string, edgeId: string): void {
    this.registry.removeFromEdgeIndex(vehicleId, edgeId);
  }
  // @ts-expect-error TS6133
  private moveInEdgeIndex(vehicleId: string, fromEdgeId: string, toEdgeId: string): void {
    this.registry.moveInEdgeIndex(vehicleId, fromEdgeId, toEdgeId);
  }
  // @ts-expect-error TS6133
  private peekNextEdge(vehicle: Vehicle): Edge {
    return this.routeManager.peekNextEdge(vehicle);
  }
  // @ts-expect-error TS6133
  private getNextEdge(vehicle: Vehicle): Edge {
    return this.routeManager.getNextEdge(vehicle);
  }
  // @ts-expect-error TS6133
  private updatePositionCore(vehicle: Vehicle, deltaMs: number, route?: Route): void {
    this.routeManager.updatePositionCore(vehicle, deltaMs, this.options, route);
  }
  // @ts-expect-error TS6133
  private handleRouteCompleted(vehicle: Vehicle): null {
    return (this.routeManager as any).handleRouteCompleted(vehicle);
  }
  // @ts-expect-error TS6133
  private updatePosition(vehicle: Vehicle, deltaMs: number): void {
    this.routeManager.updatePositionCore(vehicle, deltaMs, this.options);
  }
  // @ts-expect-error TS6133
  private updatePositionOnRoute(vehicle: Vehicle, route: Route, deltaMs: number): void {
    this.routeManager.updatePositionCore(vehicle, deltaMs, this.options, route);
  }
}
