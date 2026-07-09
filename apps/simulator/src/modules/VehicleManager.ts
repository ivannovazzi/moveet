import type {
  Vehicle,
  Incident,
  VehicleDTO,
  Direction,
  DirectionResult,
  StartOptions,
  Waypoint,
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
import { VEHICLE_PROFILES, pickRandomType } from "../utils/vehicleProfiles";
import { VehicleRegistry } from "./VehicleRegistry";
import { RouteManager } from "./RouteManager";
import { GameLoop, FAILURE_LOG_SAMPLE_RATE } from "./GameLoop";
import { AdapterSyncManager } from "./AdapterSyncManager";
import { AnalyticsAccumulator } from "./AnalyticsAccumulator";
import logger from "../utils/logger";

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

  public readonly clock = new SimulationClock({
    startHour: 7,
    speedMultiplier: 1,
  });
  private traffic = new TrafficManager(this.clock);
  public readonly fleets = new FleetManager();

  private pendingVehicleTypes?: Partial<Record<VehicleType, number>>;

  /**
   * Consecutive advance-failure count per vehicle, cleared on success.
   * Used to log the first failure and then sample (see {@link advance}),
   * mirroring GameLoop's per-vehicle failure throttling.
   */
  private advanceFailureCounts: Map<string, number> = new Map();

  private options: StartOptions = {
    updateInterval: config.updateInterval,
    // 0 means "follow updateInterval"; resolve to a concrete value up front so
    // the option is always a usable number.
    adapterSyncInterval: config.adapterSyncInterval || config.updateInterval,
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

  // ─── Initialization ───────────────────────────────────────────────

  private init(): void {
    if (!config.adapterURL) {
      this.loadFromData(this.pendingVehicleTypes);
    }
  }

  /**
   * Loads vehicle definitions from the adapter source. When `limit` is a
   * positive number, only the first `limit` source vehicles are taken (used by
   * the headless generator so the requested vehicle count caps the fleet
   * subset); otherwise the whole fleet is loaded.
   */
  public async initFromAdapter(limit?: number): Promise<void> {
    await this.adapterSync.initFromAdapter(
      (id, name, position, type, metadata) => {
        this.addVehicle(id, name, position, type ?? pickRandomType(), metadata);
      },
      () => this.loadFromData(),
      limit
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
    vehicleType: VehicleType = "car",
    metadata?: Record<string, unknown>
  ): void {
    this.registry.addVehicle(
      id,
      name,
      seedPosition,
      vehicleType,
      (vehicleId) => {
        const vehicle = this.registry.get(vehicleId)!;
        this.traffic.enter(vehicle.currentEdge.id);
        this.setRandomDestination(vehicleId);
      },
      metadata
    );
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
        this.addVehicle(v.id, v.name, v.position, v.type ?? pickRandomType(), v.metadata);
      });
    } else {
      this.loadFromData(this.pendingVehicleTypes);
    }

    this.gameLoop.reset();
    this.adapterSync.stopLocationUpdates();
    this.advanceFailureCounts.clear();
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

  /**
   * Headless fast-forward seam: the deterministic, explicit-`dt` equivalent of
   * {@link GameLoop.gameLoopTick}, but with NO `Date.now()` and NO `setInterval`.
   *
   * Ticks the simulation clock by `deltaMs` and updates every registered vehicle
   * by `deltaMs`. Per-vehicle analytics are accumulated exactly as the live loop
   * does. This is the clean public seam over the otherwise-private
   * `updateVehicle`, used by the headless generator to advance the whole sim a
   * fixed step at a time without running in real time.
   *
   * @param deltaMs - Simulated milliseconds to advance this step.
   */
  public advance(deltaMs: number): void {
    this.clock.tick(deltaMs);

    for (const vehicle of this.registry.getAll().values()) {
      // Per-vehicle error isolation: one throwing vehicle must not abort
      // the update of the remaining vehicles in this step.
      try {
        this.updateVehicle(vehicle, deltaMs);
        this.analytics.updateVehicleStats(vehicle, deltaMs);
        this.advanceFailureCounts.delete(vehicle.id);
      } catch (error) {
        // Log the first failure per vehicle, then sample so a deterministically
        // failing vehicle doesn't log on every step.
        const count = (this.advanceFailureCounts.get(vehicle.id) ?? 0) + 1;
        this.advanceFailureCounts.set(vehicle.id, count);
        if (count === 1 || count % FAILURE_LOG_SAMPLE_RATE === 0) {
          logger.error(`Failed to advance vehicle ${vehicle.id} (failure #${count}): ${error}`);
        }
      }
    }
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
    const prevSyncInterval = this.options.adapterSyncInterval;
    this.options = { ...this.options, ...startOptions };

    // setGameLoopIntervalMs restarts the running loop itself when the
    // interval actually changes, so no separate restartGameLoop call is
    // needed here.
    this.gameLoop.setGameLoopIntervalMs(this.options.updateInterval);

    // Restart the adapter-sync timer at the new cadence if it changed while a
    // run with a configured adapter is in flight.
    if (
      startOptions.adapterSyncInterval &&
      startOptions.adapterSyncInterval !== prevSyncInterval &&
      config.adapterURL &&
      this.gameLoop.getActiveVehicles().size > 0
    ) {
      this.startLocationUpdates(this.options.adapterSyncInterval);
    }

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

  /**
   * Per-vehicle source metadata (e.g. `{ devices: [{ id, deviceType }] }`) keyed
   * by vehicle id, for vehicles that carried it from the source. Used by the
   * headless generator to record the real GPS device mapping once in the header
   * so replay/emit can fan out to the real device ids.
   */
  public getVehicleMetadata(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [id, vehicle] of this.registry.getAll()) {
      if (vehicle.sourceMetadata !== undefined) {
        out[id] = vehicle.sourceMetadata;
      }
    }
    return out;
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

  // ─── Internal helpers ─────────────────────────────────────────────

  private setRandomDestination(vehicleId: string): void {
    this.routeManager.setRandomDestination(vehicleId);
  }

  private updateVehicle(vehicle: Vehicle, deltaMs: number): void {
    this.routeManager.updateVehicle(vehicle, deltaMs, this.options);
  }
}
