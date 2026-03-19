import { EventEmitter } from "events";
import type { VehicleManager } from "../VehicleManager";
import type { IncidentManager } from "../IncidentManager";
import type { SimulationController } from "../SimulationController";
import {
  scenarioSchema,
  type Scenario,
  type ScenarioEvent,
  type ScenarioStatus,
  type ScenarioState,
  type SpawnVehiclesAction,
  type CreateIncidentAction,
  type DispatchAction,
  type SetTrafficProfileAction,
  type ClearIncidentsAction,
  type SetOptionsAction,
} from "./types";
import type { VehicleType } from "../../types";

export class ScenarioManager extends EventEmitter {
  private scenario: Scenario | null = null;
  private state: ScenarioState = "idle";
  private startTime: number = 0; // wall-clock ms when scenario started
  private pausedAt: number = 0; // elapsed ms when paused
  private eventIndex: number = 0; // next event to execute
  private eventsExecuted: number = 0;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private completionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private vehicleManager: VehicleManager,
    private incidentManager: IncidentManager,
    private simulationController: SimulationController
  ) {
    super();
  }

  // ─── Public API ──────────────────────────────────────────────────

  /**
   * Validates and stores a scenario. Does not start execution.
   * @throws {Error} If scenario fails validation
   */
  loadScenario(scenario: Scenario): void {
    // Re-validate to be safe (scenario may have been constructed in code)
    const parsed = scenarioSchema.parse(scenario);
    parsed.events.sort((a, b) => a.at - b.at);
    this.scenario = parsed;
    this.resetState();
  }

  /**
   * Parses raw JSON, validates against schema, stores, and returns the parsed scenario.
   * @throws {Error} If JSON is invalid or fails schema validation
   */
  loadScenarioFromJSON(json: unknown): Scenario {
    const parsed = scenarioSchema.parse(json);
    parsed.events.sort((a, b) => a.at - b.at);
    this.scenario = parsed;
    this.resetState();
    return parsed;
  }

  /**
   * Begins executing scenario events from the beginning.
   * @throws {Error} If no scenario is loaded or scenario is already running
   */
  start(): void {
    if (!this.scenario) {
      throw new Error("No scenario loaded");
    }
    if (this.state === "running") {
      throw new Error("Scenario is already running");
    }

    this.resetState();
    this.state = "running";
    this.startTime = Date.now();

    this.emit("scenario:started", {
      name: this.scenario.name,
      eventCount: this.scenario.events.length,
    });

    this.scheduleNextEvent();
  }

  /**
   * Pauses scenario execution. Independent of simulation pause.
   */
  pause(): void {
    if (this.state !== "running") return;

    this.pausedAt = this.elapsed();
    this.clearTimers();
    this.state = "paused";

    this.emit("scenario:paused", {
      elapsed: this.pausedAt,
      nextEventIndex: this.eventIndex,
    });
  }

  /**
   * Resumes scenario execution from paused position.
   */
  resume(): void {
    if (this.state !== "paused") return;

    this.startTime = Date.now() - this.pausedAt;
    this.state = "running";

    this.emit("scenario:resumed", {
      elapsed: this.pausedAt,
      nextEventIndex: this.eventIndex,
    });

    this.scheduleNextEvent();
  }

  /**
   * Stops scenario execution and resets to idle.
   */
  stop(): void {
    if (this.state === "idle") return;

    const name = this.scenario?.name ?? "";
    const executed = this.eventsExecuted;

    this.clearTimers();
    this.state = "idle";
    this.eventIndex = 0;
    this.eventsExecuted = 0;
    this.startTime = 0;
    this.pausedAt = 0;

    this.emit("scenario:stopped", {
      name,
      eventsExecuted: executed,
    });
  }

  /**
   * Returns current scenario execution status.
   */
  getStatus(): ScenarioStatus {
    const events = this.scenario?.events ?? [];
    const upcomingStart = this.eventIndex;
    const upcomingEnd = Math.min(upcomingStart + 5, events.length);
    const upcoming = events.slice(upcomingStart, upcomingEnd).map((e) => ({
      at: e.at,
      type: e.action.type,
    }));

    return {
      state: this.state,
      scenario: this.scenario
        ? {
            name: this.scenario.name,
            duration: this.scenario.duration,
            eventCount: this.scenario.events.length,
          }
        : null,
      elapsed: this.state === "idle" ? 0 : this.elapsed() / 1000,
      eventIndex: this.eventIndex,
      eventsExecuted: this.eventsExecuted,
      upcomingEvents: upcoming,
    };
  }

  // ─── Internal ────────────────────────────────────────────────────

  private elapsed(): number {
    if (this.state === "paused") return this.pausedAt;
    if (this.state === "running") return Date.now() - this.startTime;
    return 0;
  }

  private resetState(): void {
    this.clearTimers();
    this.state = "idle";
    this.eventIndex = 0;
    this.eventsExecuted = 0;
    this.startTime = 0;
    this.pausedAt = 0;
  }

  private clearTimers(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    if (this.completionTimer !== null) {
      clearTimeout(this.completionTimer);
      this.completionTimer = null;
    }
  }

  private scheduleNextEvent(): void {
    if (!this.scenario || this.state !== "running") return;

    const events = this.scenario.events;

    if (this.eventIndex >= events.length) {
      // All events executed — schedule completion based on duration
      this.scheduleCompletion();
      return;
    }

    const event = events[this.eventIndex];
    const eventTimeMs = event.at * 1000;
    const elapsedMs = this.elapsed();
    const delay = Math.max(0, eventTimeMs - elapsedMs);

    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      if (this.state !== "running") return;
      this.executeEvent(event);
      this.eventIndex++;
      this.eventsExecuted++;
      this.scheduleNextEvent();
    }, delay);
  }

  private scheduleCompletion(): void {
    if (!this.scenario) return;

    const durationMs = this.scenario.duration * 1000;
    const elapsedMs = this.elapsed();
    const remaining = durationMs - elapsedMs;

    if (remaining <= 0) {
      this.handleCompleted();
    } else {
      this.completionTimer = setTimeout(() => {
        this.completionTimer = null;
        if (this.state === "running") {
          this.handleCompleted();
        }
      }, remaining);
    }
  }

  private handleCompleted(): void {
    const name = this.scenario?.name ?? "";
    const executed = this.eventsExecuted;
    const elapsedMs = this.elapsed();

    this.clearTimers();
    this.state = "idle";

    this.emit("scenario:completed", {
      name,
      eventsExecuted: executed,
      elapsed: elapsedMs / 1000,
    });
  }

  private executeEvent(event: ScenarioEvent): void {
    this.emit("scenario:event", {
      index: this.eventIndex,
      at: event.at,
      action: event.action,
    });

    const action = event.action;

    switch (action.type) {
      case "spawn_vehicles":
        this.handleSpawnVehicles(action);
        break;
      case "create_incident":
        this.handleCreateIncident(action);
        break;
      case "dispatch":
        void this.handleDispatch(action);
        break;
      case "set_traffic_profile":
        this.handleSetTrafficProfile(action);
        break;
      case "clear_incidents":
        this.handleClearIncidents(action);
        break;
      case "set_options":
        this.handleSetOptions(action);
        break;
    }
  }

  // ─── Action handlers ──────────────────────────────────────────────

  private handleSpawnVehicles(action: SpawnVehiclesAction): void {
    const vehicleTypes = action.vehicleTypes as Partial<Record<VehicleType, number>> | undefined;

    if (vehicleTypes && Object.keys(vehicleTypes).length > 0) {
      // Spawn vehicles by type distribution
      const existingCount = this.vehicleManager.getVehicles().length;
      let idx = existingCount;
      for (const [type, count] of Object.entries(vehicleTypes)) {
        for (let i = 0; i < (count as number); i++) {
          this.vehicleManager.registry.addVehicle(
            `scenario-${idx}`,
            `SV${idx}`,
            undefined,
            type as VehicleType,
            (vehicleId) => {
              // Start movement for the new vehicle if simulation is running
              if (this.vehicleManager.isRunning()) {
                const interval = this.vehicleManager.getOptions().updateInterval;
                this.vehicleManager.startVehicleMovement(vehicleId, interval);
              }
            }
          );
          idx++;
        }
      }
    } else {
      // Spawn count vehicles of default type
      const existingCount = this.vehicleManager.getVehicles().length;
      for (let i = 0; i < action.count; i++) {
        const idx = existingCount + i;
        this.vehicleManager.registry.addVehicle(
          `scenario-${idx}`,
          `SV${idx}`,
          undefined,
          "car",
          (vehicleId) => {
            if (this.vehicleManager.isRunning()) {
              const interval = this.vehicleManager.getOptions().updateInterval;
              this.vehicleManager.startVehicleMovement(vehicleId, interval);
            }
          }
        );
      }
    }
  }

  private handleCreateIncident(action: CreateIncidentAction): void {
    let edgeIds = action.edgeIds;

    if (!edgeIds && action.position) {
      // Resolve position to edge IDs via nearest node
      const network = this.vehicleManager.getNetwork();
      const node = network.findNearestNode([action.position.lat, action.position.lng]);
      edgeIds = node.connections.map((edge) => edge.id);
    }

    if (edgeIds && edgeIds.length > 0) {
      const position = action.position
        ? ([action.position.lat, action.position.lng] as [number, number])
        : undefined;

      this.incidentManager.createIncident(
        edgeIds,
        action.incidentType,
        action.duration * 1000,
        action.severity ?? 0.5,
        position
      );
    }
  }

  private async handleDispatch(action: DispatchAction): Promise<void> {
    await this.simulationController.setDirections([
      {
        id: action.vehicleId,
        lat: action.waypoints[0].lat,
        lng: action.waypoints[0].lng,
        waypoints: action.waypoints,
      },
    ]);
  }

  private handleSetTrafficProfile(action: SetTrafficProfileAction): void {
    this.simulationController.setTrafficProfile({
      name: action.name,
      timeRanges: action.timeRanges,
    });
  }

  private handleClearIncidents(action: ClearIncidentsAction): void {
    if (action.incidentIds && action.incidentIds.length > 0) {
      for (const id of action.incidentIds) {
        this.incidentManager.removeIncident(id);
      }
    } else {
      this.incidentManager.clearAll();
    }
  }

  private handleSetOptions(action: SetOptionsAction): void {
    this.vehicleManager.setOptions(action.options);
  }
}
