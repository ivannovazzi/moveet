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

  /**
   * Retention window for analytics_history rows. Rows older than this are
   * pruned on each auto-save tick so the table (written every few seconds) does
   * not grow without bound. 7 days keeps a useful history while bounding size.
   */
  private static readonly ANALYTICS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

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
      // Off-load the snapshot serialization across event-loop turns so the 5×
      // JSON.stringify of full state does not stall the loop in one burst.
      this.saveNowChunked().catch((err) => {
        log.error(`Auto-save failed: ${err}`);
      });
      // Bound the analytics_history table (written every few seconds).
      this.pruneAnalyticsHistory();
    }, intervalMs);
  }

  /**
   * Prunes analytics_history rows older than the retention window. Safe no-op
   * on any error (best-effort housekeeping that must never break auto-save).
   */
  private pruneAnalyticsHistory(): void {
    try {
      const cutoff = new Date(Date.now() - PersistenceManager.ANALYTICS_RETENTION_MS).toISOString();
      const removed = this.stateStore.pruneAnalyticsHistory(cutoff);
      if (removed > 0) {
        log.info(`Pruned ${removed} analytics_history row(s) older than ${cutoff}`);
      }
    } catch (err) {
      log.error(`Analytics-history prune failed: ${err}`);
    }
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
   * Like {@link saveNow}, but serializes each section across event-loop turns
   * so the 5× full-state `JSON.stringify` does not block the loop in one burst.
   * Used by the auto-save timer. The DB write itself is still atomic — only the
   * (CPU-bound) serialization is chunked.
   */
  async saveNowChunked(): Promise<SnapshotMeta> {
    const data = await this.collectSnapshotChunked();
    const meta = this.stateStore.saveSnapshot(data);
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

  /**
   * Async variant of {@link collectSnapshot} that yields the event loop between
   * each section's `JSON.stringify`, so a large fleet's serialization is spread
   * across turns instead of stalling the loop in one synchronous burst.
   */
  async collectSnapshotChunked(): Promise<SnapshotData> {
    const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

    const vehicles = JSON.stringify(this.vehicleManager.getVehicles());
    await yieldToLoop();
    const fleets = JSON.stringify(this.fleetManager.getFleets());
    await yieldToLoop();
    const geofences = JSON.stringify(this.geoFenceManager.getAllZones());
    await yieldToLoop();
    const incidents = JSON.stringify(
      this.incidentManager.getActiveIncidents().map((i) => this.incidentManager.toDTO(i))
    );
    await yieldToLoop();
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
