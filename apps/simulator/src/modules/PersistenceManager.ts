import { EventEmitter } from "events";
import type { StateStore, SnapshotData, SnapshotMeta, SnapshotRow } from "./StateStore";
import type { VehicleManager } from "./VehicleManager";
import type { FleetManager } from "./FleetManager";
import type { GeoFenceManager } from "./GeoFenceManager";
import type { IncidentManager } from "./IncidentManager";
import type { GeoFence } from "@moveet/shared-types";
import { createLogger } from "../utils/logger";

const log = createLogger("PersistenceManager");

export interface PersistenceManagerDeps {
  stateStore: StateStore;
  vehicleManager: VehicleManager;
  fleetManager: FleetManager;
  geoFenceManager: GeoFenceManager;
  incidentManager: IncidentManager;
}

/**
 * Coordinates periodic and manual snapshot save/restore across all managers.
 *
 * Emits:
 * - `snapshot:saved`   — after a snapshot is persisted (payload: SnapshotMeta)
 * - `snapshot:restored` — after state is restored from a snapshot
 */
export class PersistenceManager extends EventEmitter {
  private stateStore: StateStore;
  private vehicleManager: VehicleManager;
  private fleetManager: FleetManager;
  private geoFenceManager: GeoFenceManager;
  private incidentManager: IncidentManager;

  private autoSaveTimer: NodeJS.Timeout | null = null;

  constructor(deps: PersistenceManagerDeps) {
    super();
    this.stateStore = deps.stateStore;
    this.vehicleManager = deps.vehicleManager;
    this.fleetManager = deps.fleetManager;
    this.geoFenceManager = deps.geoFenceManager;
    this.incidentManager = deps.incidentManager;
  }

  // ─── Auto-save ──────────────────────────────────────────────────────

  /**
   * Starts periodic snapshots at the given interval.
   * @param intervalMs Milliseconds between snapshots (default 30000).
   */
  startAutoSave(intervalMs: number = 30_000): void {
    this.stopAutoSave();
    log.info(`Auto-save started (interval: ${intervalMs}ms)`);
    this.autoSaveTimer = setInterval(() => {
      try {
        this.saveNow();
      } catch (err) {
        log.error(`Auto-save failed: ${err}`);
      }
    }, intervalMs);
  }

  /**
   * Stops periodic snapshots.
   */
  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
      log.info("Auto-save stopped");
    }
  }

  // ─── Manual save / restore ──────────────────────────────────────────

  /**
   * Immediately captures and persists a snapshot of all simulation state.
   */
  saveNow(): SnapshotMeta {
    const data = this.collectSnapshot();
    const meta = this.stateStore.saveSnapshot(data);
    // Keep at most 50 snapshots to prevent unbounded growth
    this.stateStore.deleteOldSnapshots(50);
    log.info(`Snapshot saved (id: ${meta.id})`);
    this.emit("snapshot:saved", meta);
    return meta;
  }

  /**
   * Restores simulation state from the latest snapshot.
   * @returns true if a snapshot was found and applied, false otherwise.
   */
  restore(): boolean {
    const row = this.stateStore.getLatestSnapshot();
    if (!row) {
      log.info("No snapshot found to restore");
      return false;
    }
    this.applySnapshot(row);
    log.info(`Snapshot restored (id: ${row.id}, created_at: ${row.created_at})`);
    this.emit("snapshot:restored", { id: row.id, created_at: row.created_at });
    return true;
  }

  // ─── Snapshot collection ────────────────────────────────────────────

  /**
   * Gathers the current state from all managers into a SnapshotData object.
   * All values are JSON-serialized strings.
   */
  collectSnapshot(): SnapshotData {
    // Vehicles: serialize VehicleDTOs (position, speed, bearing, etc.)
    const vehicles = JSON.stringify(this.vehicleManager.getVehicles());

    // Fleets
    const fleets = JSON.stringify(this.fleetManager.getFleets());

    // Geofences
    const geofences = JSON.stringify(this.geoFenceManager.getAllZones());

    // Incidents
    const incidents = JSON.stringify(
      this.incidentManager.getActiveIncidents().map((i) => this.incidentManager.toDTO(i))
    );

    // Analytics summary
    const analytics = JSON.stringify(this.vehicleManager.analytics.getSnapshot());

    return { vehicles, fleets, geofences, incidents, analytics };
  }

  // ─── Snapshot application ───────────────────────────────────────────

  /**
   * Applies a stored snapshot to all managers, restoring simulation state.
   *
   * Note: Vehicle *movement* state (routes, game loop) is NOT restored — only
   * static fleet/geofence/incident definitions. The simulation needs to be
   * restarted after restore for vehicles to resume moving.
   */
  applySnapshot(row: SnapshotRow): void {
    // Restore fleets
    try {
      const fleets = JSON.parse(row.fleets);
      this.fleetManager.restoreFleets(fleets);
    } catch (err) {
      log.error(`Failed to restore fleets: ${err}`);
    }

    // Restore geofences
    try {
      const geofences = JSON.parse(row.geofences);
      this.restoreGeofences(geofences);
    } catch (err) {
      log.error(`Failed to restore geofences: ${err}`);
    }

    // Restore incidents
    try {
      const incidents = JSON.parse(row.incidents);
      this.restoreIncidents(incidents);
    } catch (err) {
      log.error(`Failed to restore incidents: ${err}`);
    }
  }

  // ─── Internal restore helpers ───────────────────────────────────────

  private restoreGeofences(geofences: GeoFence[]): void {
    // Clear existing zones by removing all, then re-adding
    for (const zone of this.geoFenceManager.getAllZones()) {
      this.geoFenceManager.removeZone(zone.id);
    }
    for (const zone of geofences) {
      this.geoFenceManager.addZone(zone);
    }
  }

  private restoreIncidents(incidents: Array<Record<string, unknown>>): void {
    this.incidentManager.restoreIncidents(incidents);
  }

  // ─── Cleanup ────────────────────────────────────────────────────────

  /**
   * Stops auto-save and closes the state store.
   */
  shutdown(): void {
    this.stopAutoSave();
    this.stateStore.close();
  }
}
