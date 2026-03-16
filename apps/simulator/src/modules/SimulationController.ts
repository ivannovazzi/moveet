import type { VehicleManager } from "./VehicleManager";
import type { IncidentManager } from "./IncidentManager";
import { ReplayManager } from "./ReplayManager";
import type {
  DirectionRequest,
  DirectionResult,
  Direction,
  Incident,
  RecordingHeader,
  ReplayStatus,
  SimulationStatus,
  StartOptions,
  VehicleDTO,
} from "../types";
import { TIME_INTERVALS } from "../constants";
import { config } from "../utils/config";
import EventEmitter from "events";

interface ResetPayload {
  vehicles: VehicleDTO[];
  directions: Direction[];
}

type EventEmitterMap = {
  updateStatus: [SimulationStatus];
  reset: [ResetPayload];
  replayStatus: [ReplayStatus];
  replayVehicle: [unknown];
  replayDirection: [unknown];
  "replayIncident:created": [unknown];
  "replayIncident:cleared": [unknown];
  replayHeatzones: [unknown];
  "replayWaypoint:reached": [unknown];
  "replayRoute:completed": [unknown];
  "replayVehicle:rerouted": [unknown];
  "replaySimulation:start": [unknown];
  "replaySimulation:stop": [unknown];
  "replaySimulation:reset": [unknown];
};

export class SimulationController extends EventEmitter<EventEmitterMap> {
  private autoHeatZoneInterval?: NodeJS.Timeout;
  private _ready = false;
  private incidentManager?: IncidentManager;
  private _mode: "live" | "replay" = "live";
  private replayManager?: ReplayManager;

  constructor(
    private vehicleManager: VehicleManager,
    incidentManager?: IncidentManager
  ) {
    super();
    this.incidentManager = incidentManager;
    // When no adapter is configured, vehicles are loaded synchronously
    // in the VehicleManager constructor, so we're immediately ready.
    if (!config.adapterURL) {
      this._ready = true;
    }
  }

  /**
   * Returns the current simulation mode: 'live' or 'replay'.
   */
  public get mode(): "live" | "replay" {
    return this._mode;
  }

  /**
   * Marks the simulation as ready after async initialization completes.
   * Called from main() after initFromAdapter() resolves.
   */
  public markReady(): void {
    this._ready = true;
    this.emit("updateStatus", this.getStatus());
  }

  /**
   * Gets the current simulation status including runtime state and configuration.
   *
   * @returns Current simulation status with running state and update interval
   *
   * @example
   * const status = controller.getStatus();
   * console.log(`Simulation running: ${status.running}`);
   * console.log(`Update interval: ${status.interval}ms`);
   */
  getStatus(): SimulationStatus {
    return {
      interval: this.vehicleManager.getOptions().updateInterval,
      running: this.vehicleManager.isRunning(),
      ready: this._ready,
    };
  }

  /**
   * Gets the current vehicle update interval in milliseconds.
   *
   * @returns Update interval in milliseconds
   */
  public getInterval(): number {
    return this.vehicleManager.getOptions().updateInterval;
  }

  /**
   * Resets the simulation to its initial state.
   * Stops all vehicle movements, clears routes, and reinitializes vehicles.
   * Emits 'updateStatus' event after reset completes.
   *
   * @returns Promise that resolves when reset is complete
   *
   * @example
   * await controller.reset();
   * console.log('Simulation reset to initial state');
   */
  async reset(): Promise<void> {
    this._ready = false;
    this.stop();
    if (this.incidentManager) {
      this.incidentManager.clearAll();
      this.vehicleManager.getNetwork().clearIncidentEdges();
    }
    await this.vehicleManager.reset();
    this._ready = true;
    this.emit("reset", {
      vehicles: this.vehicleManager.getVehicles(),
      directions: this.vehicleManager.getDirections(),
    });
    this.emit("updateStatus", this.getStatus());
  }

  /**
   * Starts the simulation with optional configuration overrides.
   * Begins vehicle movement updates, adapter synchronization (if ADAPTER_URL is configured),
   * and automatic heat zone regeneration every 5 minutes.
   * Emits 'updateStatus' event after start completes.
   *
   * @param options - Optional partial configuration to override defaults
   * @returns Promise that resolves when simulation has started
   *
   * @example
   * await controller.start({ updateInterval: 1000, maxSpeed: 80 });
   * console.log('Simulation started with custom speed limit');
   */
  async start(options: Partial<StartOptions>): Promise<void> {
    this.vehicleManager.setOptions(options);

    const intervalMs = this.vehicleManager.getOptions().updateInterval;

    for (const v of this.vehicleManager.getVehicles()) {
      this.vehicleManager.startVehicleMovement(v.id, intervalMs);
    }

    if (config.adapterURL) {
      this.vehicleManager.startLocationUpdates(config.syncAdapterTimeout);
    }

    // Start incident cleanup and wire event listeners
    if (this.incidentManager) {
      this.incidentManager.startCleanup();
      this.incidentManager.on("incident:created", (incident: Incident) => {
        this.rebuildIncidentEdges();
        this.vehicleManager.handleIncidentCreated(incident);
      });
      this.incidentManager.on("incident:cleared", () => {
        this.rebuildIncidentEdges();
      });
    }

    // Automatically regenerate heat zones every 5 minutes
    if (!this.autoHeatZoneInterval) {
      this.vehicleManager.getNetwork().generateHeatedZones();
      this.autoHeatZoneInterval = setInterval(() => {
        // Generate new heat zones
        this.vehicleManager.getNetwork().generateHeatedZones();
      }, TIME_INTERVALS.HEAT_ZONE_REGEN_INTERVAL);
    }

    this.emit("updateStatus", this.getStatus());
  }

  /**
   * Sets destinations for one or more vehicles.
   * Each vehicle will calculate and follow a route to its assigned destination.
   *
   * @param requests - Array of direction requests, each containing vehicle ID and destination coordinates
   * @returns Promise that resolves when all routes have been calculated and set
   *
   * @example
   * await controller.setDirections([
   *   { id: 'vehicle-1', lat: 45.5017, lng: -73.5673 },
   *   { id: 'vehicle-2', lat: 45.5088, lng: -73.5878 }
   * ]);
   */
  async setDirections(requests: DirectionRequest[]): Promise<DirectionResult[]> {
    const results: DirectionResult[] = [];
    for (const request of requests) {
      const { id, lat, lng, waypoints } = request;
      if (waypoints && waypoints.length > 0) {
        // Multi-stop routing: convert WaypointRequest[] to Waypoint[]
        const waypointPositions = waypoints.map((wp) => ({
          position: [wp.lat, wp.lng] as [number, number],
          dwellTime: wp.dwellTime,
          label: wp.label,
        }));
        const result = await this.vehicleManager.findAndSetWaypointRoutes(id, waypointPositions);
        results.push(result);
      } else {
        // Single-destination routing (backward compat)
        const result = await this.vehicleManager.findAndSetRoutes(id, [lat, lng]);
        results.push(result);
      }
    }
    return results;
  }

  /**
   * Stops all simulation activity.
   * Halts vehicle movement updates, adapter synchronization,
   * and automatic heat zone regeneration.
   * Emits 'updateStatus' event after stop completes.
   *
   * @example
   * controller.stop();
   * console.log('Simulation stopped');
   */
  public stop(): void {
    // Stop incident cleanup
    if (this.incidentManager) {
      this.incidentManager.stopCleanup();
    }

    // Stop all vehicle updates
    for (const v of this.vehicleManager.getVehicles()) {
      this.vehicleManager.stopVehicleMovement(v.id);
    }
    // Stop location updates
    this.vehicleManager.stopLocationUpdates();

    // Clear auto heat zone interval to prevent memory leak
    if (this.autoHeatZoneInterval) {
      clearInterval(this.autoHeatZoneInterval);
      this.autoHeatZoneInterval = undefined;
    }

    this.emit("updateStatus", this.getStatus());
  }

  /**
   * Updates simulation configuration options.
   * Emits 'updateStatus' event after options are applied.
   *
   * @param options - Complete simulation options configuration
   * @returns Promise that resolves when options have been applied
   *
   * @example
   * await controller.setOptions({
   *   updateInterval: 500,
   *   minSpeed: 30,
   *   maxSpeed: 70,
   * });
   */
  async setOptions(options: StartOptions): Promise<void> {
    this.vehicleManager.setOptions(options);
    this.emit("updateStatus", this.getStatus());
  }

  /**
   * Gets the current simulation configuration options.
   *
   * @returns Current simulation options including speeds, intervals, and adapter settings
   */
  public getOptions(): StartOptions {
    return this.vehicleManager.getOptions();
  }

  /**
   * Gets all vehicles in the simulation with their current state.
   *
   * @returns Array of vehicle DTOs containing position, speed, status, and flags
   *
   * @example
   * const vehicles = controller.getVehicles();
   * console.log(`Total vehicles: ${vehicles.length}`);
   */
  public getVehicles(): VehicleDTO[] {
    return this.vehicleManager.getVehicles();
  }

  /**
   * Returns the IncidentManager instance, if one was provided.
   */
  public getIncidentManager(): IncidentManager | undefined {
    return this.incidentManager;
  }

  // ─── Replay Mode ────────────────────────────────────────────────────

  /**
   * Starts replay mode: stops the live simulation if running, loads the
   * recording file, and begins playback. ReplayManager events are forwarded
   * as SimulationController events so the WS broadcaster picks them up.
   *
   * @param filePath - Path to the NDJSON recording file
   * @param speed - Playback speed multiplier (default: 1.0)
   * @returns The recording header metadata
   */
  async startReplay(filePath: string, speed?: number): Promise<RecordingHeader> {
    // Stop any existing replay first
    if (this.replayManager) {
      this.replayManager.stopReplay();
    }

    // Stop live simulation if running
    if (this.vehicleManager.isRunning()) {
      this.stop();
    }

    this._mode = "replay";

    // Create a fresh ReplayManager and wire up event forwarding.
    // Hold a local ref so a concurrent call can't swap it out from under us.
    const replay = new ReplayManager();
    this.replayManager = replay;
    this.wireReplayEvents(replay);

    const header = await replay.loadRecording(filePath);

    // Guard: if another startReplay() replaced our manager while we were
    // loading, this call is stale — bail out instead of crashing.
    if (this.replayManager !== replay) {
      replay.stopReplay();
      throw new Error("Replay superseded by a newer request");
    }

    replay.startReplay(speed);

    return header;
  }

  /**
   * Pauses the current replay.
   */
  pauseReplay(): void {
    if (this._mode !== "replay" || !this.replayManager) return;
    this.replayManager.pauseReplay();
  }

  /**
   * Resumes the current replay from its paused position.
   */
  resumeReplay(): void {
    if (this._mode !== "replay" || !this.replayManager) return;
    this.replayManager.resumeReplay();
  }

  /**
   * Stops replay mode and returns to live mode.
   * Cleans up the ReplayManager instance.
   */
  stopReplay(): void {
    if (this.replayManager) {
      this.replayManager.stopReplay();
      this.replayManager.removeAllListeners();
      this.replayManager = undefined;
    }
    this._mode = "live";
    this.emit("replayStatus", { mode: "live" });
  }

  /**
   * Seeks to a specific timestamp in the recording.
   *
   * @param timestamp - Target timestamp in ms offset from the start of the recording
   */
  seekReplay(timestamp: number): void {
    if (this._mode !== "replay" || !this.replayManager) return;
    this.replayManager.seekTo(timestamp);
  }

  /**
   * Changes playback speed without restarting the replay.
   */
  setReplaySpeed(speed: number): void {
    if (this._mode !== "replay" || !this.replayManager) return;
    this.replayManager.setSpeed(speed);
  }

  /**
   * Returns the current replay status, or a default live status if not in replay mode.
   */
  getReplayStatus(): ReplayStatus {
    if (this.replayManager) {
      return this.replayManager.getStatus();
    }
    return { mode: "live" };
  }

  /**
   * Wires ReplayManager events to SimulationController events
   * so the WS broadcaster can forward them to clients.
   */
  private wireReplayEvents(rm: ReplayManager): void {
    const forwardEvents = [
      ["vehicle", "replayVehicle"],
      ["direction", "replayDirection"],
      ["incident:created", "replayIncident:created"],
      ["incident:cleared", "replayIncident:cleared"],
      ["heatzones", "replayHeatzones"],
      ["waypoint:reached", "replayWaypoint:reached"],
      ["route:completed", "replayRoute:completed"],
      ["vehicle:rerouted", "replayVehicle:rerouted"],
      ["simulation:start", "replaySimulation:start"],
      ["simulation:stop", "replaySimulation:stop"],
      ["simulation:reset", "replaySimulation:reset"],
    ] as const;

    for (const [source, target] of forwardEvents) {
      rm.on(source, (data: unknown) => {
        (this.emit as (event: string, ...args: unknown[]) => boolean)(target, data);
      });
    }

    rm.on("replayStatus", (status: ReplayStatus) => {
      this.emit("replayStatus", status);
    });

    rm.on("replayEnd", () => {
      this.stopReplay();
    });
  }

  /**
   * Rebuilds the edge speed-factor map from all active incidents and
   * pushes it into the road network. If no incidents remain, clears the map.
   */
  private rebuildIncidentEdges(): void {
    if (!this.incidentManager) return;

    const incidents = this.incidentManager.getActiveIncidents();
    const edgeSpeedFactors = new Map<string, number>();

    for (const incident of incidents) {
      for (const edgeId of incident.edgeIds) {
        const current = edgeSpeedFactors.get(edgeId);
        if (current === undefined || incident.speedFactor < current) {
          edgeSpeedFactors.set(edgeId, incident.speedFactor);
        }
      }
    }

    const network = this.vehicleManager.getNetwork();
    if (edgeSpeedFactors.size === 0) {
      network.clearIncidentEdges();
    } else {
      network.setIncidentEdges(edgeSpeedFactors);
    }
  }
}
