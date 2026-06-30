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
      expect(addVehicle).toHaveBeenCalledWith("v1", "Vehicle 1", [1.0, 36.0], undefined, undefined);
      expect(addVehicle).toHaveBeenCalledWith("v2", "Vehicle 2", [1.1, 36.1], undefined, undefined);
      expect(loadFallback).not.toHaveBeenCalled();
    });

    it("should pass source metadata through to addVehicle", async () => {
      (config as any).adapterURL = "http://localhost:5011";
      syncManager = new AdapterSyncManager();

      const adapter = (syncManager as any).adapter;
      vi.spyOn(adapter, "get").mockResolvedValue([
        {
          id: "v1",
          name: "Vehicle 1",
          position: [1.0, 36.0] as [number, number],
          metadata: { deviceType: "gps", vehicleId: "v1" },
        },
      ]);

      const addVehicle = vi.fn();
      const loadFallback = vi.fn();

      await syncManager.initFromAdapter(addVehicle, loadFallback);

      expect(addVehicle).toHaveBeenCalledWith("v1", "Vehicle 1", [1.0, 36.0], undefined, {
        deviceType: "gps",
        vehicleId: "v1",
      });
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
      const mockVehicles = [{ id: "v1", name: "Vehicle 1", position: [1.0, 36.0] }];
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

    it("should clear the sync timer on stop", () => {
      syncManager.startLocationUpdates(5000, function* () {} as any);
      const timer = (syncManager as any).syncTimer;
      expect(timer).not.toBeNull();

      syncManager.stopLocationUpdates();
      expect((syncManager as any).syncTimer).toBeNull();
    });

    it("should replace the existing sync timer on second start", () => {
      syncManager.startLocationUpdates(5000, function* () {} as any);
      const first = (syncManager as any).syncTimer;

      syncManager.startLocationUpdates(3000, function* () {} as any);
      const second = (syncManager as any).syncTimer;

      expect(second).not.toBe(first);
      syncManager.stopLocationUpdates();
    });

    it("should carry vehicle sourceMetadata through to the sync payload", async () => {
      const adapter = (syncManager as any).adapter;
      const syncSpy = vi.spyOn(adapter, "sync").mockResolvedValue(undefined);

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
          sourceMetadata: { deviceType: "gps", vehicleId: "v1" },
        };
      };

      vi.useFakeTimers();
      try {
        syncManager.startLocationUpdates(1000, getVehicles as any);
        await vi.advanceTimersByTimeAsync(1000);
      } finally {
        syncManager.stopLocationUpdates();
        vi.useRealTimers();
      }

      expect(syncSpy).toHaveBeenCalledTimes(1);
      const payload = syncSpy.mock.calls[0][0] as { vehicles: any[] };
      expect(payload.vehicles[0]).toMatchObject({
        id: "v1",
        latitude: 1.0,
        longitude: 36.0,
        metadata: { deviceType: "gps", vehicleId: "v1" },
      });
    });

    it("should omit metadata from the sync payload when the vehicle has none", async () => {
      const adapter = (syncManager as any).adapter;
      const syncSpy = vi.spyOn(adapter, "sync").mockResolvedValue(undefined);

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

      vi.useFakeTimers();
      try {
        syncManager.startLocationUpdates(1000, getVehicles as any);
        await vi.advanceTimersByTimeAsync(1000);
      } finally {
        syncManager.stopLocationUpdates();
        vi.useRealTimers();
      }

      const payload = syncSpy.mock.calls[0][0] as { vehicles: any[] };
      expect(payload.vehicles[0]).not.toHaveProperty("metadata");
    });

    it("should generate and forward a correlation id per sync cycle", async () => {
      const adapter = (syncManager as any).adapter;
      const syncSpy = vi.spyOn(adapter, "sync").mockResolvedValue(undefined);

      vi.useFakeTimers();
      try {
        syncManager.startLocationUpdates(1000, function* () {} as any);
        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(1000);
      } finally {
        syncManager.stopLocationUpdates();
        vi.useRealTimers();
      }

      expect(syncSpy).toHaveBeenCalledTimes(2);
      // Each cycle passes a non-empty correlation id as the second argument.
      const firstCorrelation = syncSpy.mock.calls[0][1] as string;
      const secondCorrelation = syncSpy.mock.calls[1][1] as string;
      expect(typeof firstCorrelation).toBe("string");
      expect(firstCorrelation.length).toBeGreaterThan(0);
      // A fresh id is generated each cycle.
      expect(secondCorrelation).not.toBe(firstCorrelation);
    });
  });

  // ─── Backoff on sync failures ─────────────────────────────────────

  describe("sync failure backoff", () => {
    let randomSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // Eliminate jitter for deterministic timing
      randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
      vi.useFakeTimers();
    });

    afterEach(() => {
      syncManager.stopLocationUpdates();
      vi.useRealTimers();
      randomSpy.mockRestore();
    });

    it("should back off exponentially on consecutive failures", async () => {
      const adapter = (syncManager as any).adapter;
      const syncSpy = vi.spyOn(adapter, "sync").mockRejectedValue(new Error("adapter down"));

      syncManager.startLocationUpdates(1000, function* () {} as any);

      // First attempt at +1000ms — fails
      await vi.advanceTimersByTimeAsync(1000);
      expect(syncSpy).toHaveBeenCalledTimes(1);

      // After 1 failure the next attempt is delayed 2× (2000ms), not 1000ms
      await vi.advanceTimersByTimeAsync(1000);
      expect(syncSpy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(syncSpy).toHaveBeenCalledTimes(2);

      // After 2 failures the next attempt is delayed 4× (4000ms)
      await vi.advanceTimersByTimeAsync(3999);
      expect(syncSpy).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(syncSpy).toHaveBeenCalledTimes(3);
    });

    it("should cap the backoff delay", async () => {
      const adapter = (syncManager as any).adapter;
      const syncSpy = vi.spyOn(adapter, "sync").mockRejectedValue(new Error("adapter down"));

      syncManager.startLocationUpdates(10_000, function* () {} as any);

      // Fail many times; the delay must never exceed 60s (cap) even though
      // 10s × 2^n grows past it quickly.
      await vi.advanceTimersByTimeAsync(10_000); // attempt 1
      expect(syncSpy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(20_000); // attempt 2 (2×)
      expect(syncSpy).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(40_000); // attempt 3 (4×)
      expect(syncSpy).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(60_000); // attempt 4 (capped at 60s, not 80s)
      expect(syncSpy).toHaveBeenCalledTimes(4);
      await vi.advanceTimersByTimeAsync(60_000); // attempt 5 (still capped)
      expect(syncSpy).toHaveBeenCalledTimes(5);
    });

    it("should cap the backoff at 60s even when the interval exceeds the cap", async () => {
      // Regression: a previous bug computed the cap as max(intervalMs, 60s), so
      // an interval ABOVE 60s made the cap == interval and silently defeated the
      // 60s ceiling. With the fix (min(interval*2^n, 60s)), the very first
      // backed-off retry must fire at +60s, not at +interval.
      const adapter = (syncManager as any).adapter;
      const syncSpy = vi.spyOn(adapter, "sync").mockRejectedValue(new Error("adapter down"));

      const interval = 100_000; // 100s — above the 60s cap
      syncManager.startLocationUpdates(interval, function* () {} as any);

      // First attempt fires at +interval and fails.
      await vi.advanceTimersByTimeAsync(interval);
      expect(syncSpy).toHaveBeenCalledTimes(1);

      // Next attempt is capped at 60s: nothing at 59.999s, fires at 60s.
      await vi.advanceTimersByTimeAsync(59_999);
      expect(syncSpy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(syncSpy).toHaveBeenCalledTimes(2);

      // And it stays capped at 60s on subsequent failures.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(syncSpy).toHaveBeenCalledTimes(3);
    });

    it("should reset the delay to the configured interval after a successful sync", async () => {
      const adapter = (syncManager as any).adapter;
      const syncSpy = vi
        .spyOn(adapter, "sync")
        .mockRejectedValueOnce(new Error("adapter down"))
        .mockResolvedValue(undefined);

      syncManager.startLocationUpdates(1000, function* () {} as any);

      // First attempt fails
      await vi.advanceTimersByTimeAsync(1000);
      expect(syncSpy).toHaveBeenCalledTimes(1);

      // Second attempt at +2000ms succeeds
      await vi.advanceTimersByTimeAsync(2000);
      expect(syncSpy).toHaveBeenCalledTimes(2);

      // Back to the normal 1000ms cadence
      await vi.advanceTimersByTimeAsync(1000);
      expect(syncSpy).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1000);
      expect(syncSpy).toHaveBeenCalledTimes(4);
    });

    it("should stop scheduling attempts after stopLocationUpdates", async () => {
      const adapter = (syncManager as any).adapter;
      const syncSpy = vi.spyOn(adapter, "sync").mockResolvedValue(undefined);

      syncManager.startLocationUpdates(1000, function* () {} as any);
      await vi.advanceTimersByTimeAsync(1000);
      expect(syncSpy).toHaveBeenCalledTimes(1);

      syncManager.stopLocationUpdates();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(syncSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Drain ────────────────────────────────────────────────────────

  describe("drain", () => {
    it("should resolve immediately when no sync is in flight", async () => {
      await expect(syncManager.drain(1000)).resolves.toBeUndefined();
    });

    it("should wait for an in-flight sync to settle", async () => {
      vi.useFakeTimers();
      try {
        const adapter = (syncManager as any).adapter;
        let resolveSync: () => void = () => {};
        vi.spyOn(adapter, "sync").mockImplementation(
          () => new Promise<void>((resolve) => (resolveSync = resolve))
        );

        syncManager.startLocationUpdates(1000, function* () {} as any);
        await vi.advanceTimersByTimeAsync(1000); // sync now in flight

        let drained = false;
        const drainPromise = syncManager.drain(5000).then(() => {
          drained = true;
        });

        // Still in flight — drain has not resolved
        await vi.advanceTimersByTimeAsync(100);
        expect(drained).toBe(false);

        // Settle the sync — drain resolves
        resolveSync();
        await drainPromise;
        expect(drained).toBe(true);
      } finally {
        syncManager.stopLocationUpdates();
        vi.useRealTimers();
      }
    });

    it("should keep tracking the new session's sync when a stale sync settles after a restart", async () => {
      vi.useFakeTimers();
      try {
        const adapter = (syncManager as any).adapter;
        const resolvers: Array<() => void> = [];
        vi.spyOn(adapter, "sync").mockImplementation(
          () => new Promise<void>((resolve) => resolvers.push(resolve))
        );

        // First session: sync goes in flight and stays pending
        syncManager.startLocationUpdates(1000, function* () {} as any);
        await vi.advanceTimersByTimeAsync(1000);
        expect(resolvers).toHaveLength(1);

        // Restart while the first sync is still awaiting; second session's
        // sync also goes in flight
        syncManager.startLocationUpdates(1000, function* () {} as any);
        await vi.advanceTimersByTimeAsync(1000);
        expect(resolvers).toHaveLength(2);

        // The stale (first) sync settles — it must NOT null out the new
        // session's tracked promise
        resolvers[0]();
        await vi.advanceTimersByTimeAsync(0);
        expect((syncManager as any).inFlightSync).not.toBeNull();

        // drain() still waits for the new session's in-flight sync
        let drained = false;
        const drainPromise = syncManager.drain(5000).then(() => {
          drained = true;
        });
        await vi.advanceTimersByTimeAsync(100);
        expect(drained).toBe(false);

        resolvers[1]();
        await drainPromise;
        expect(drained).toBe(true);
        await vi.advanceTimersByTimeAsync(0);
        expect((syncManager as any).inFlightSync).toBeNull();
      } finally {
        syncManager.stopLocationUpdates();
        vi.useRealTimers();
      }
    });
  });
});
