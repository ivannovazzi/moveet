import type { Vehicle, VehicleStats, AnalyticsSummary, FleetAnalytics } from "../types";
import type { VehicleRegistry } from "./VehicleRegistry";
import type { FleetManager } from "./FleetManager";

/**
 * Incrementally accumulates per-vehicle analytics stats each game loop tick.
 *
 * Called after updateVehicle in gameLoopTick to track distance traveled,
 * idle/active time, average speed, waypoints reached, and route efficiency.
 */
export class AnalyticsAccumulator {
  private stats: Map<string, VehicleStats> = new Map();

  /** Previous position per vehicle, used to calculate distance delta. */
  private prevPositions: Map<string, [number, number]> = new Map();

  /** Running sum of speed samples per vehicle, for rolling average. */
  private speedSamples: Map<string, { sum: number; count: number }> = new Map();

  constructor(
    private registry: VehicleRegistry,
    private fleetManager: FleetManager
  ) {}

  // ─── Per-tick update ─────────────────────────────────────────────

  /**
   * Called once per tick per vehicle, after updateVehicle has run.
   * Accumulates distance, idle/active time, and speed stats.
   */
  updateVehicleStats(vehicle: Vehicle, deltaMs: number): void {
    const stats = this.getOrCreateStats(vehicle.id);
    const deltaSec = deltaMs / 1000;
    const now = Date.now();

    if (vehicle.speed > 0) {
      // Vehicle is moving
      stats.activeTime += deltaSec;

      // Calculate distance delta from speed: distance = speed (km/h) * time (h)
      const distanceDelta = (vehicle.speed / 3600) * (deltaMs / 1000); // km
      stats.distanceTraveled += distanceDelta;
      stats.actualDistance += distanceDelta;

      // Update rolling average speed
      const samples = this.getOrCreateSpeedSamples(vehicle.id);
      samples.sum += vehicle.speed;
      samples.count += 1;
      stats.avgSpeed = samples.sum / samples.count;
    } else {
      // Vehicle is idle (speed === 0 or dwelling at waypoint)
      stats.idleTime += deltaSec;
    }

    stats.lastUpdated = now;
    this.prevPositions.set(vehicle.id, [...vehicle.position]);
  }

  // ─── Event handlers ──────────────────────────────────────────────

  /**
   * Called when a waypoint is reached.
   */
  onWaypointReached(vehicleId: string): void {
    const stats = this.getOrCreateStats(vehicleId);
    stats.waypointsReached += 1;
  }

  /**
   * Called when a direction/route is set for a vehicle.
   * Records the optimal (shortest-path) distance for efficiency tracking.
   */
  onDirectionSet(vehicleId: string, routeDistance: number): void {
    const stats = this.getOrCreateStats(vehicleId);
    stats.optimalDistance = routeDistance;
    // Reset actual distance for the new route segment
    stats.actualDistance = 0;
  }

  // ─── Query methods ───────────────────────────────────────────────

  getStats(vehicleId: string): VehicleStats | undefined {
    return this.stats.get(vehicleId);
  }

  getAllStats(): Map<string, VehicleStats> {
    return this.stats;
  }

  /**
   * Computes the fleet-level summary for a specific fleet.
   */
  getFleetStats(fleetId: string): FleetAnalytics {
    const fleet = this.fleetManager.getFleets().find((f) => f.id === fleetId);
    const vehicleIds = fleet?.vehicleIds ?? [];

    const vehicleStatsList: VehicleStats[] = [];
    let totalDistance = 0;
    let totalIdleTime = 0;
    let speedSum = 0;
    let speedCount = 0;
    let efficiencySum = 0;
    let efficiencyCount = 0;
    let activeCount = 0;

    for (const vid of vehicleIds) {
      const vs = this.stats.get(vid);
      if (!vs) continue;
      vehicleStatsList.push(vs);
      totalDistance += vs.distanceTraveled;
      totalIdleTime += vs.idleTime;
      if (vs.avgSpeed > 0) {
        speedSum += vs.avgSpeed;
        speedCount += 1;
      }
      if (vs.optimalDistance > 0 && vs.actualDistance > 0) {
        efficiencySum += vs.optimalDistance / vs.actualDistance;
        efficiencyCount += 1;
      }

      // Consider vehicle active if it had recent activity
      const vehicle = this.registry.get(vid);
      if (vehicle && vehicle.speed > 0) {
        activeCount += 1;
      }
    }

    return {
      fleetId,
      vehicleCount: vehicleIds.length,
      activeCount,
      totalDistance,
      avgSpeed: speedCount > 0 ? speedSum / speedCount : 0,
      totalIdleTime,
      routeEfficiency: efficiencyCount > 0 ? efficiencySum / efficiencyCount : 1,
      vehicles: vehicleStatsList,
    };
  }

  /**
   * Computes the global analytics summary across all vehicles.
   */
  getSummary(): AnalyticsSummary {
    const allVehicles = this.registry.getAll();
    const totalVehicles = allVehicles.size;
    let activeVehicles = 0;
    let totalDistanceTraveled = 0;
    let totalIdleTime = 0;
    let speedSum = 0;
    let speedCount = 0;
    let efficiencySum = 0;
    let efficiencyCount = 0;

    for (const [vid, vehicle] of allVehicles) {
      if (vehicle.speed > 0) {
        activeVehicles += 1;
      }

      const vs = this.stats.get(vid);
      if (!vs) continue;
      totalDistanceTraveled += vs.distanceTraveled;
      totalIdleTime += vs.idleTime;
      if (vs.avgSpeed > 0) {
        speedSum += vs.avgSpeed;
        speedCount += 1;
      }
      if (vs.optimalDistance > 0 && vs.actualDistance > 0) {
        efficiencySum += vs.optimalDistance / vs.actualDistance;
        efficiencyCount += 1;
      }
    }

    return {
      totalVehicles,
      activeVehicles,
      totalDistanceTraveled,
      avgSpeed: speedCount > 0 ? speedSum / speedCount : 0,
      totalIdleTime,
      avgRouteEfficiency: efficiencyCount > 0 ? efficiencySum / efficiencyCount : 1,
      timestamp: Date.now(),
    };
  }

  /**
   * Builds a full analytics snapshot (summary + per-fleet breakdowns).
   */
  getSnapshot(): { summary: AnalyticsSummary; fleets: FleetAnalytics[] } {
    const summary = this.getSummary();
    const fleets = this.fleetManager
      .getFleets()
      .map((f) => this.getFleetStats(f.id));

    return { summary, fleets };
  }

  // ─── Reset ───────────────────────────────────────────────────────

  resetStats(): void {
    this.stats.clear();
    this.prevPositions.clear();
    this.speedSamples.clear();
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private getOrCreateStats(vehicleId: string): VehicleStats {
    let s = this.stats.get(vehicleId);
    if (!s) {
      s = {
        distanceTraveled: 0,
        idleTime: 0,
        activeTime: 0,
        avgSpeed: 0,
        optimalDistance: 0,
        actualDistance: 0,
        waypointsReached: 0,
        lastUpdated: Date.now(),
      };
      this.stats.set(vehicleId, s);
    }
    return s;
  }

  private getOrCreateSpeedSamples(vehicleId: string): { sum: number; count: number } {
    let s = this.speedSamples.get(vehicleId);
    if (!s) {
      s = { sum: 0, count: 0 };
      this.speedSamples.set(vehicleId, s);
    }
    return s;
  }
}
