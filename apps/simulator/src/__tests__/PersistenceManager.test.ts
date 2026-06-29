import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { StateStore } from "../modules/StateStore";
import { PersistenceManager } from "../modules/PersistenceManager";
import { FleetManager } from "../modules/FleetManager";
import { GeoFenceManager } from "../modules/GeoFenceManager";
import { IncidentManager } from "../modules/IncidentManager";

// Minimal VehicleManager mock that satisfies PersistenceManager's read-only usage
function createMockVehicleManager() {
  return {
    getVehicles: vi
      .fn()
      .mockReturnValue([
        { id: "v1", name: "V1", position: [1.0, 2.0], speed: 30, bearing: 90, type: "car" },
      ]),
    analytics: {
      getSnapshot: vi.fn().mockReturnValue({
        summary: { totalVehicles: 1, activeVehicles: 1 },
        fleets: [],
      }),
    },
  } as any;
}

describe("PersistenceManager", () => {
  let stateStore: StateStore;
  let fleetManager: FleetManager;
  let geoFenceManager: GeoFenceManager;
  let incidentManager: IncidentManager;
  let pm: PersistenceManager;

  beforeEach(() => {
    stateStore = new StateStore(":memory:");
    fleetManager = new FleetManager();
    geoFenceManager = new GeoFenceManager();
    incidentManager = new IncidentManager();

    pm = new PersistenceManager({
      stateStore,
      vehicleManager: createMockVehicleManager(),
      fleetManager,
      geoFenceManager,
      incidentManager,
    });
  });

  afterEach(() => {
    pm.shutdown();
  });

  // ─── Manual save / restore ────────────────────────────────────────

  describe("saveNow", () => {
    it("should persist a snapshot and return metadata", () => {
      const meta = pm.saveNow();
      expect(meta.id).toBe(1);
      expect(meta.created_at).toBeDefined();
    });

    it("should emit snapshot:saved event", () => {
      const listener = vi.fn();
      pm.on("snapshot:saved", listener);
      pm.saveNow();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    });

    it("should capture fleet state in the snapshot", () => {
      fleetManager.createFleet("Alpha");
      pm.saveNow();

      const row = stateStore.getLatestSnapshot();
      expect(row).not.toBeNull();
      const fleets = JSON.parse(row!.fleets);
      expect(fleets).toHaveLength(1);
      expect(fleets[0].name).toBe("Alpha");
    });

    it("should capture geofence state in the snapshot", () => {
      geoFenceManager.addZone({
        id: "z1",
        name: "Zone1",
        type: "restricted",
        polygon: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
        active: true,
      });
      pm.saveNow();

      const row = stateStore.getLatestSnapshot();
      const zones = JSON.parse(row!.geofences);
      expect(zones).toHaveLength(1);
      expect(zones[0].name).toBe("Zone1");
    });

    it("should capture incident state in the snapshot", () => {
      incidentManager.createIncident(["e1"], "accident", 60000, 0.5);
      pm.saveNow();

      const row = stateStore.getLatestSnapshot();
      const incidents = JSON.parse(row!.incidents);
      expect(incidents).toHaveLength(1);
      expect(incidents[0].type).toBe("accident");
    });
  });

  describe("restore", () => {
    it("should return false when no snapshot exists", () => {
      const result = pm.restore();
      expect(result).toBe(false);
    });

    it("should restore fleet state from a snapshot", () => {
      // Create a fleet, save, then reset
      const fleet = fleetManager.createFleet("Bravo");
      fleetManager.assignVehicles(fleet.id, ["v1"]);
      pm.saveNow();

      fleetManager.reset();
      expect(fleetManager.getFleets()).toHaveLength(0);

      // Restore
      const result = pm.restore();
      expect(result).toBe(true);
      expect(fleetManager.getFleets()).toHaveLength(1);
      expect(fleetManager.getFleets()[0].name).toBe("Bravo");
      expect(fleetManager.getFleets()[0].vehicleIds).toContain("v1");
    });

    it("should restore geofence state from a snapshot", () => {
      geoFenceManager.addZone({
        id: "z2",
        name: "Delivery",
        type: "delivery",
        polygon: [
          [10, 10],
          [11, 10],
          [11, 11],
          [10, 11],
        ],
        active: false,
      });
      pm.saveNow();

      // Clear zones
      geoFenceManager.removeZone("z2");
      expect(geoFenceManager.getAllZones()).toHaveLength(0);

      pm.restore();
      expect(geoFenceManager.getAllZones()).toHaveLength(1);
      expect(geoFenceManager.getAllZones()[0].name).toBe("Delivery");
      expect(geoFenceManager.getAllZones()[0].active).toBe(false);
    });

    it("should restore incident state from a snapshot", () => {
      incidentManager.createIncident(["e5", "e6"], "construction", 120000, 0.3);
      pm.saveNow();

      incidentManager.clearAll();
      expect(incidentManager.getActiveIncidents()).toHaveLength(0);

      pm.restore();
      expect(incidentManager.getActiveIncidents()).toHaveLength(1);
      expect(incidentManager.getActiveIncidents()[0].type).toBe("construction");
      expect(incidentManager.getActiveIncidents()[0].edgeIds).toEqual(["e5", "e6"]);
    });

    it("should emit snapshot:restored event", () => {
      pm.saveNow();
      const listener = vi.fn();
      pm.on("snapshot:restored", listener);

      pm.restore();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    });
  });

  // ─── Auto-save ────────────────────────────────────────────────────

  describe("autoSave", () => {
    it("should save snapshots at the specified interval", async () => {
      vi.useFakeTimers();

      pm.startAutoSave(100);

      // Auto-save now serializes asynchronously (setImmediate-chunked), so use
      // the async timer advance to flush the queued saves to completion.
      await vi.advanceTimersByTimeAsync(350);

      const list = stateStore.listSnapshots(20);
      expect(list.length).toBe(3);

      pm.stopAutoSave();
      vi.useRealTimers();
    });

    it("should stop saving when stopAutoSave is called", async () => {
      vi.useFakeTimers();

      pm.startAutoSave(100);
      await vi.advanceTimersByTimeAsync(150);
      pm.stopAutoSave();
      await vi.advanceTimersByTimeAsync(300);

      const list = stateStore.listSnapshots(20);
      expect(list.length).toBe(1);

      vi.useRealTimers();
    });
  });

  // ─── collectSnapshot ─────────────────────────────────────────────

  describe("collectSnapshot", () => {
    it("should return all manager state as JSON strings", () => {
      const data = pm.collectSnapshot();
      expect(typeof data.vehicles).toBe("string");
      expect(typeof data.fleets).toBe("string");
      expect(typeof data.geofences).toBe("string");
      expect(typeof data.incidents).toBe("string");
      expect(typeof data.analytics).toBe("string");

      // Should be valid JSON
      expect(() => JSON.parse(data.vehicles)).not.toThrow();
      expect(() => JSON.parse(data.fleets)).not.toThrow();
      expect(() => JSON.parse(data.geofences)).not.toThrow();
      expect(() => JSON.parse(data.incidents)).not.toThrow();
      expect(() => JSON.parse(data.analytics)).not.toThrow();
    });

    it("collectSnapshotChunked yields the same data as collectSnapshot", async () => {
      const sync = pm.collectSnapshot();
      const chunked = await pm.collectSnapshotChunked();
      expect(chunked).toEqual(sync);
    });
  });

  // ─── Chunked save ─────────────────────────────────────────────────

  describe("saveNowChunked", () => {
    it("persists a snapshot just like saveNow", async () => {
      const meta = await pm.saveNowChunked();
      expect(meta.id).toBeGreaterThan(0);
      const row = stateStore.getLatestSnapshot();
      expect(row?.id).toBe(meta.id);
      expect(JSON.parse(row!.vehicles)).toHaveLength(1);
    });

    it("emits snapshot:saved", async () => {
      const handler = vi.fn();
      pm.on("snapshot:saved", handler);
      await pm.saveNowChunked();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Analytics-history pruning on auto-save ───────────────────────

  describe("analytics-history pruning", () => {
    it("prunes rows older than the retention window on each auto-save tick", async () => {
      // Old row (well beyond the 7-day window) + a fresh row.
      const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      stateStore.insertAnalytics({
        summary: { totalVehicles: 0, activeVehicles: 0 } as any,
        fleets: [],
        timestamp: Date.parse(old),
      });
      stateStore.insertAnalytics({
        summary: { totalVehicles: 1, activeVehicles: 1 } as any,
        fleets: [],
        timestamp: Date.now(),
      });
      expect(stateStore.getAnalyticsHistoryCount()).toBe(2);

      vi.useFakeTimers();
      try {
        pm.startAutoSave(100);
        await vi.advanceTimersByTimeAsync(100);
      } finally {
        pm.stopAutoSave();
        vi.useRealTimers();
      }

      // The stale row is gone; the fresh row remains.
      expect(stateStore.getAnalyticsHistoryCount()).toBe(1);
    });
  });
});
