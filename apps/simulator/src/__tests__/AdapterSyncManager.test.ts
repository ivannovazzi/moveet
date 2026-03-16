import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AdapterSyncManager } from "../modules/AdapterSyncManager";
import { config } from "../utils/config";

describe("AdapterSyncManager", () => {
  let syncManager: AdapterSyncManager;
  let origAdapterURL: string;

  beforeEach(() => {
    origAdapterURL = config.adapterURL;
    (config as any).adapterURL = "";
    syncManager = new AdapterSyncManager();
  });

  afterEach(() => {
    (config as any).adapterURL = origAdapterURL;
    syncManager.stopLocationUpdates();
  });

  // ─── initFromAdapter ──────────────────────────────────────────────

  describe("initFromAdapter", () => {
    it("should do nothing when adapterURL is not configured", async () => {
      const addVehicle = vi.fn();
      const loadFallback = vi.fn();

      await syncManager.initFromAdapter(addVehicle, loadFallback);

      expect(addVehicle).not.toHaveBeenCalled();
      expect(loadFallback).not.toHaveBeenCalled();
    });

    it("should call loadFallback when adapter returns no vehicles", async () => {
      (config as any).adapterURL = "http://localhost:5011";
      syncManager = new AdapterSyncManager();

      // Mock the adapter.get to return empty array
      const adapter = (syncManager as any).adapter;
      vi.spyOn(adapter, "get").mockResolvedValue([]);

      const addVehicle = vi.fn();
      const loadFallback = vi.fn();

      await syncManager.initFromAdapter(addVehicle, loadFallback);

      expect(addVehicle).not.toHaveBeenCalled();
      expect(loadFallback).toHaveBeenCalledTimes(1);
    });

    it("should call addVehicle for each adapter vehicle", async () => {
      (config as any).adapterURL = "http://localhost:5011";
      syncManager = new AdapterSyncManager();

      const adapter = (syncManager as any).adapter;
      vi.spyOn(adapter, "get").mockResolvedValue([
        { id: "v1", name: "Vehicle 1", position: [1.0, 36.0] as [number, number] },
        { id: "v2", name: "Vehicle 2", position: [1.1, 36.1] as [number, number] },
      ]);

      const addVehicle = vi.fn();
      const loadFallback = vi.fn();

      await syncManager.initFromAdapter(addVehicle, loadFallback);

      expect(addVehicle).toHaveBeenCalledTimes(2);
      expect(addVehicle).toHaveBeenCalledWith("v1", "Vehicle 1", [1.0, 36.0]);
      expect(addVehicle).toHaveBeenCalledWith("v2", "Vehicle 2", [1.1, 36.1]);
      expect(loadFallback).not.toHaveBeenCalled();
    });

    it("should call loadFallback when adapter throws", async () => {
      (config as any).adapterURL = "http://localhost:5011";
      syncManager = new AdapterSyncManager();

      const adapter = (syncManager as any).adapter;
      vi.spyOn(adapter, "get").mockRejectedValue(new Error("Connection refused"));

      const addVehicle = vi.fn();
      const loadFallback = vi.fn();

      await syncManager.initFromAdapter(addVehicle, loadFallback);

      expect(addVehicle).not.toHaveBeenCalled();
      expect(loadFallback).toHaveBeenCalledTimes(1);
    });
  });

  // ─── fetchAdapterVehicles ─────────────────────────────────────────

  describe("fetchAdapterVehicles", () => {
    it("should return null when adapterURL is not configured", async () => {
      const result = await syncManager.fetchAdapterVehicles();
      expect(result).toBeNull();
    });

    it("should return vehicles when adapter succeeds", async () => {
      (config as any).adapterURL = "http://localhost:5011";
      syncManager = new AdapterSyncManager();

      const adapter = (syncManager as any).adapter;
      const mockVehicles = [
        { id: "v1", name: "Vehicle 1", position: [1.0, 36.0] },
      ];
      vi.spyOn(adapter, "get").mockResolvedValue(mockVehicles);

      const result = await syncManager.fetchAdapterVehicles();
      expect(result).toEqual(mockVehicles);
    });

    it("should return null when adapter returns empty array", async () => {
      (config as any).adapterURL = "http://localhost:5011";
      syncManager = new AdapterSyncManager();

      const adapter = (syncManager as any).adapter;
      vi.spyOn(adapter, "get").mockResolvedValue([]);

      const result = await syncManager.fetchAdapterVehicles();
      expect(result).toBeNull();
    });

    it("should return null when adapter throws", async () => {
      (config as any).adapterURL = "http://localhost:5011";
      syncManager = new AdapterSyncManager();

      const adapter = (syncManager as any).adapter;
      vi.spyOn(adapter, "get").mockRejectedValue(new Error("Fail"));

      const result = await syncManager.fetchAdapterVehicles();
      expect(result).toBeNull();
    });
  });

  // ─── Location updates ─────────────────────────────────────────────

  describe("startLocationUpdates / stopLocationUpdates", () => {
    it("should start and stop without error", () => {
      const getVehicles = function* () {
        yield {
          id: "v1",
          name: "V1",
          type: "car" as const,
          position: [1.0, 36.0] as [number, number],
          currentEdge: { id: "e1" } as any,
          speed: 30,
          bearing: 90,
          progress: 0,
        };
      };

      expect(() => {
        syncManager.startLocationUpdates(5000, getVehicles as any);
      }).not.toThrow();

      expect(() => {
        syncManager.stopLocationUpdates();
      }).not.toThrow();
    });

    it("should clear interval on stop", () => {
      syncManager.startLocationUpdates(5000, function* () {} as any);
      const interval = (syncManager as any).locationInterval;
      expect(interval).not.toBeNull();

      syncManager.stopLocationUpdates();
      expect((syncManager as any).locationInterval).toBeNull();
    });

    it("should replace existing interval on second start", () => {
      syncManager.startLocationUpdates(5000, function* () {} as any);
      const first = (syncManager as any).locationInterval;

      syncManager.startLocationUpdates(3000, function* () {} as any);
      const second = (syncManager as any).locationInterval;

      expect(second).not.toBe(first);
      syncManager.stopLocationUpdates();
    });
  });
});
