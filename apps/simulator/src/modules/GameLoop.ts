import type { Vehicle } from "../types";
import type { SimulationClock } from "./SimulationClock";
import type { VehicleRegistry } from "./VehicleRegistry";
import type { FleetManager } from "./FleetManager";
import type { AnalyticsAccumulator } from "./AnalyticsAccumulator";
import { config } from "../utils/config";
import { serializeVehicle } from "../utils/serializer";
import { EventEmitter } from "events";
import logger from "../utils/logger";

/**
 * Maximum tick delta as a multiple of the loop interval. Deltas larger than
 * this (e.g. after the event loop stalls or the host machine sleeps) are
 * clamped so vehicles don't teleport on the next tick.
 */
const MAX_DELTA_FACTOR = 2;

/**
 * After the first per-vehicle update failure is logged, repeat failures are
 * only logged every Nth occurrence so a deterministically failing vehicle
 * doesn't flood the logs on every tick. Shared with VehicleManager.advance.
 */
export const FAILURE_LOG_SAMPLE_RATE = 100;

/**
 * Callback type for updating a vehicle each tick.
 * The facade can override this to allow test interception.
 */
export type UpdateVehicleFn = (vehicle: Vehicle, deltaMs: number) => void;

/**
 * Manages the single game loop that ticks all active vehicles.
 * Emits: 'update' (VehicleDTO per vehicle per tick)
 */
export class GameLoop extends EventEmitter {
  private activeVehicles: Set<string> = new Set();
  private gameLoopInterval: NodeJS.Timeout | null = null;
  private gameLoopIntervalMs: number = config.updateInterval;
  private lastClockTick: number = Date.now();
  private lastUpdateTimes: Map<string, number> = new Map();
  /** Consecutive update-failure count per vehicle, cleared on success. */
  private failureCounts: Map<string, number> = new Map();

  /**
   * The function called to update each vehicle per tick.
   * Assigned by the facade so that tests can stub it via (manager as any).updateVehicle.
   */
  public updateVehicleFn: UpdateVehicleFn;

  /**
   * Optional analytics accumulator. When set, stats are updated each tick per vehicle.
   */
  public analyticsAccumulator: AnalyticsAccumulator | null = null;

  constructor(
    private registry: VehicleRegistry,
    updateVehicleFn: UpdateVehicleFn,
    private fleetManager: FleetManager,
    private clock: SimulationClock
  ) {
    super();
    this.updateVehicleFn = updateVehicleFn;
  }

  // ─── Game loop control ────────────────────────────────────────────

  /**
   * Starts the single game loop if not already running.
   */
  startGameLoop(intervalMs: number): void {
    this.gameLoopIntervalMs = intervalMs;
    if (this.gameLoopInterval) return;

    this.gameLoopInterval = setInterval(() => this.gameLoopTick(), intervalMs);
  }

  /**
   * Stops the game loop.
   */
  stopGameLoop(): void {
    if (this.gameLoopInterval) {
      clearInterval(this.gameLoopInterval);
      this.gameLoopInterval = null;
    }
  }

  /**
   * Restarts the game loop with a new interval, preserving active vehicles.
   */
  restartGameLoop(intervalMs: number): void {
    this.stopGameLoop();
    if (this.activeVehicles.size > 0) {
      this.startGameLoop(intervalMs);
    }
  }

  /**
   * Single game loop tick: updates all active vehicles.
   */
  gameLoopTick(): void {
    const now = Date.now();
    const maxDeltaMs = this.gameLoopIntervalMs * MAX_DELTA_FACTOR;

    // Tick simulation clock once per game loop. Clamp the delta so a stalled
    // event loop or host sleep doesn't fast-forward the simulation.
    const rawClockDelta = now - this.lastClockTick;
    this.lastClockTick = now;
    let clockDelta = rawClockDelta;
    if (clockDelta > maxDeltaMs) {
      logger.warn(`Game loop tick delta ${rawClockDelta}ms exceeds max ${maxDeltaMs}ms; clamping`);
      clockDelta = maxDeltaMs;
    }
    this.clock.tick(clockDelta);

    for (const vehicleId of this.activeVehicles) {
      const vehicle = this.registry.get(vehicleId);
      if (!vehicle) continue;

      const lastUpdate = this.lastUpdateTimes.get(vehicleId) ?? now;
      const deltaMs = Math.min(now - lastUpdate, maxDeltaMs);
      this.lastUpdateTimes.set(vehicleId, now);

      // Per-vehicle error isolation: one throwing vehicle must not abort
      // the whole tick (or crash the interval callback).
      try {
        this.updateVehicleFn(vehicle, deltaMs);

        // Accumulate per-vehicle analytics stats after movement update
        if (this.analyticsAccumulator) {
          this.analyticsAccumulator.updateVehicleStats(vehicle, deltaMs);
        }

        this.emit(
          "update",
          serializeVehicle(vehicle, this.fleetManager.getVehicleFleetId(vehicleId))
        );
        this.failureCounts.delete(vehicleId);
      } catch (error) {
        // Log the first failure per vehicle, then sample so a deterministically
        // failing vehicle doesn't log on every tick.
        const count = (this.failureCounts.get(vehicleId) ?? 0) + 1;
        this.failureCounts.set(vehicleId, count);
        if (count === 1 || count % FAILURE_LOG_SAMPLE_RATE === 0) {
          logger.error(`Failed to update vehicle ${vehicleId} (failure #${count}): ${error}`);
        }
      }
    }
  }

  // ─── Vehicle activation ───────────────────────────────────────────

  startVehicleMovement(vehicleId: string, intervalMs: number): void {
    this.lastUpdateTimes.set(vehicleId, Date.now());
    this.activeVehicles.add(vehicleId);

    if (!this.gameLoopInterval) {
      this.startGameLoop(intervalMs);
    } else if (intervalMs !== this.gameLoopIntervalMs) {
      this.restartGameLoop(intervalMs);
    }
  }

  stopVehicleMovement(vehicleId: string): void {
    this.activeVehicles.delete(vehicleId);

    if (this.activeVehicles.size === 0) {
      this.stopGameLoop();
    }
  }

  isRunning(): boolean {
    return this.activeVehicles.size > 0;
  }

  getGameLoopIntervalMs(): number {
    return this.gameLoopIntervalMs;
  }

  /**
   * Updates the tick-rate. If the loop is currently running with a different
   * interval, restarts it immediately so the change takes effect on this call
   * rather than waiting for the next vehicle activation/deactivation (which is
   * the only other path that calls restartGameLoop/startGameLoop).
   */
  setGameLoopIntervalMs(intervalMs: number): void {
    const changed = intervalMs !== this.gameLoopIntervalMs;
    this.gameLoopIntervalMs = intervalMs;
    if (changed && this.gameLoopInterval) {
      this.restartGameLoop(intervalMs);
    }
  }

  // ─── Accessors for internals (used by setOptions) ─────────────────

  getActiveVehicles(): Set<string> {
    return this.activeVehicles;
  }

  getGameLoopIntervalRef(): NodeJS.Timeout | null {
    return this.gameLoopInterval;
  }

  getLastUpdateTimes(): Map<string, number> {
    return this.lastUpdateTimes;
  }

  // ─── Reset ────────────────────────────────────────────────────────

  reset(): void {
    this.stopGameLoop();
    this.activeVehicles.clear();
    this.lastUpdateTimes.clear();
    this.failureCounts.clear();
  }
}
