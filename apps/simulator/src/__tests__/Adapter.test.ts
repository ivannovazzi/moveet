import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import Adapter from "../modules/Adapter";

// Mock the config module
vi.mock("../utils/config", () => ({
  config: {
    adapterURL: "http://localhost:3001",
  },
}));

// Mock the logger
vi.mock("../utils/logger", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("Adapter", () => {
  let adapter: Adapter;

  beforeEach(() => {
    adapter = new Adapter();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("get", () => {
    it("should fetch vehicles from adapter endpoint", async () => {
      const mockVehicles = [
        {
          id: "vehicle-1",
          name: "Vehicle 1",
          position: [45.5017, -73.5673] as [number, number],
        },
        {
          id: "vehicle-2",
          name: "Vehicle 2",
          position: [45.502, -73.567] as [number, number],
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockVehicles,
      });

      const vehicles = await adapter.get();

      expect(vehicles).toEqual(mockVehicles);
      expect(global.fetch).toHaveBeenCalledWith("http://localhost:3001/vehicles", {
        method: "GET",
      });
    });

    it("should throw error when fetch fails with non-ok status", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(adapter.get()).rejects.toThrow("Adapter request to /vehicles failed");
    });

    it("should throw error when network request fails", async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error("Network error"));

      await expect(adapter.get()).rejects.toThrow("Adapter request to /vehicles failed");
    });

    it("should throw error when response is not valid JSON", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      await expect(adapter.get()).rejects.toThrow();
    });

    it("should handle server error responses", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(adapter.get()).rejects.toThrow(
        "Adapter request failed: 500 Internal Server Error"
      );
    });
  });

  describe("sync", () => {
    it("should sync vehicles to adapter endpoint", async () => {
      const syncData = {
        vehicles: [
          {
            id: "vehicle-1",
            name: "Vehicle 1",
            latitude: 45.5017,
            longitude: -73.5673,
          },
        ],
        timestamp: Date.now(),
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await adapter.sync(syncData);

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3001/sync",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(syncData),
        })
      );
    });

    it("should throw error when sync fails", async () => {
      const syncData = {
        vehicles: [],
        timestamp: Date.now(),
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      });

      await expect(adapter.sync(syncData)).rejects.toThrow("Adapter request to /sync failed");
    });

    it("should handle network errors during sync", async () => {
      const syncData = {
        vehicles: [],
      };

      (global.fetch as any).mockRejectedValueOnce(new Error("Connection refused"));

      await expect(adapter.sync(syncData)).rejects.toThrow("Adapter request to /sync failed");
    });

    it("should send correct headers and body", async () => {
      const syncData = {
        vehicles: [
          {
            id: "vehicle-1",
            name: "Vehicle 1",
            latitude: 45.5,
            longitude: -73.5,
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await adapter.sync(syncData);

      const callArgs = (global.fetch as any).mock.calls[0];
      expect(callArgs[1].headers["Content-Type"]).toBe("application/json");
      expect(JSON.parse(callArgs[1].body)).toEqual(syncData);
    });

    it("should handle empty vehicle array", async () => {
      const syncData = {
        vehicles: [],
        timestamp: Date.now(),
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await expect(adapter.sync(syncData)).resolves.not.toThrow();
    });
  });

  describe("error handling", () => {
    it("should include original error message in thrown error", async () => {
      const originalError = new Error("Original network error");
      (global.fetch as any).mockRejectedValueOnce(originalError);

      await expect(adapter.get()).rejects.toThrow("Original network error");
    });

    it("should handle non-Error objects thrown during fetch", async () => {
      (global.fetch as any).mockRejectedValueOnce("String error");

      await expect(adapter.get()).rejects.toThrow("Adapter request to /vehicles failed");
    });

    it("should properly format error messages with path", async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error("Test error"));

      try {
        await adapter.get();
        expect.fail("Should have thrown error");
      } catch (error: any) {
        expect(error.message).toContain("/vehicles");
        expect(error.message).toContain("Test error");
      }
    });
  });

  describe("integration scenarios", () => {
    it("should handle multiple concurrent get requests", async () => {
      const mockVehicles = [
        {
          id: "vehicle-1",
          name: "Vehicle 1",
          position: [45.5, -73.5] as [number, number],
        },
      ];

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockVehicles,
      });

      const requests = [adapter.get(), adapter.get(), adapter.get()];
      const results = await Promise.all(requests);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual(mockVehicles);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it("should handle get followed by sync", async () => {
      const mockVehicles = [
        {
          id: "vehicle-1",
          name: "Vehicle 1",
          position: [45.5, -73.5] as [number, number],
        },
      ];

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockVehicles,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        });

      const vehicles = await adapter.get();
      expect(vehicles).toHaveLength(1);

      await adapter.sync({
        vehicles: [
          {
            id: vehicles[0].id,
            name: vehicles[0].name,
            latitude: 45.51,
            longitude: -73.51,
          },
        ],
        timestamp: Date.now(),
      });

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });
});
