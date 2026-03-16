import { describe, it, expect } from "vitest";
import {
  WS_BROADCASTER,
  SPATIAL_GRID,
  TIME_INTERVALS,
  HEAT_ZONE_DEFAULTS,
  VEHICLE_CONSTANTS,
  FLEET_COLORS,
} from "../constants";

describe("constants", () => {
  describe("WS_BROADCASTER", () => {
    it("should define BACKPRESSURE_THRESHOLD as 64 KB", () => {
      expect(WS_BROADCASTER.BACKPRESSURE_THRESHOLD).toBe(64 * 1024);
    });

    it("should define MAX_DROPPED_FLUSHES as a positive integer", () => {
      expect(WS_BROADCASTER.MAX_DROPPED_FLUSHES).toBe(50);
      expect(Number.isInteger(WS_BROADCASTER.MAX_DROPPED_FLUSHES)).toBe(true);
    });

    it("should define POSITION_DELTA_THRESHOLD as a small positive number", () => {
      expect(WS_BROADCASTER.POSITION_DELTA_THRESHOLD).toBe(0.00001);
      expect(WS_BROADCASTER.POSITION_DELTA_THRESHOLD).toBeGreaterThan(0);
      expect(WS_BROADCASTER.POSITION_DELTA_THRESHOLD).toBeLessThan(0.001);
    });

    it("should define DEFAULT_FLUSH_INTERVAL_MS as 100", () => {
      expect(WS_BROADCASTER.DEFAULT_FLUSH_INTERVAL_MS).toBe(100);
    });
  });

  describe("SPATIAL_GRID", () => {
    it("should define CELL_SIZE as 0.005 (~500m in degrees)", () => {
      expect(SPATIAL_GRID.CELL_SIZE).toBe(0.005);
    });

    it("should be positive and less than 1 degree", () => {
      expect(SPATIAL_GRID.CELL_SIZE).toBeGreaterThan(0);
      expect(SPATIAL_GRID.CELL_SIZE).toBeLessThan(1);
    });
  });

  describe("shared SPATIAL_GRID.CELL_SIZE is used by HeatZoneManager and RoadNetwork", () => {
    it("HeatZoneManager GRID_CELL_SIZE matches SPATIAL_GRID.CELL_SIZE", async () => {
      const { HeatZoneManager } = await import("../modules/HeatZoneManager");
      const manager = new HeatZoneManager();
      // Access the private static via the class
      const cellSize = (HeatZoneManager as unknown as { GRID_CELL_SIZE: number }).GRID_CELL_SIZE;
      expect(cellSize).toBe(SPATIAL_GRID.CELL_SIZE);
    });
  });

  describe("WS_BROADCASTER constants are used by WebSocketBroadcaster", () => {
    it("re-exported constants match centralized values", async () => {
      const {
        BACKPRESSURE_THRESHOLD,
        MAX_DROPPED_FLUSHES,
        POSITION_DELTA_THRESHOLD,
      } = await import("../modules/WebSocketBroadcaster");

      expect(BACKPRESSURE_THRESHOLD).toBe(WS_BROADCASTER.BACKPRESSURE_THRESHOLD);
      expect(MAX_DROPPED_FLUSHES).toBe(WS_BROADCASTER.MAX_DROPPED_FLUSHES);
      expect(POSITION_DELTA_THRESHOLD).toBe(WS_BROADCASTER.POSITION_DELTA_THRESHOLD);
    });
  });

  describe("TIME_INTERVALS", () => {
    it("should define HEAT_ZONE_REGEN_INTERVAL as 5 minutes in ms", () => {
      expect(TIME_INTERVALS.HEAT_ZONE_REGEN_INTERVAL).toBe(5 * 60 * 1000);
    });
  });

  describe("HEAT_ZONE_DEFAULTS", () => {
    it("should have valid count and radius ranges", () => {
      expect(HEAT_ZONE_DEFAULTS.COUNT).toBeGreaterThan(0);
      expect(HEAT_ZONE_DEFAULTS.MIN_RADIUS).toBeGreaterThan(0);
      expect(HEAT_ZONE_DEFAULTS.MAX_RADIUS).toBeGreaterThan(HEAT_ZONE_DEFAULTS.MIN_RADIUS);
    });

    it("should have intensity values in [0, 1] range", () => {
      expect(HEAT_ZONE_DEFAULTS.MIN_INTENSITY).toBeGreaterThanOrEqual(0);
      expect(HEAT_ZONE_DEFAULTS.MIN_INTENSITY).toBeLessThanOrEqual(1);
      expect(HEAT_ZONE_DEFAULTS.MAX_INTENSITY).toBeGreaterThanOrEqual(
        HEAT_ZONE_DEFAULTS.MIN_INTENSITY
      );
      expect(HEAT_ZONE_DEFAULTS.MAX_INTENSITY).toBeLessThanOrEqual(1);
    });
  });

  describe("VEHICLE_CONSTANTS", () => {
    it("should define MAX_VISITED_EDGES as a positive integer", () => {
      expect(VEHICLE_CONSTANTS.MAX_VISITED_EDGES).toBe(1000);
      expect(Number.isInteger(VEHICLE_CONSTANTS.MAX_VISITED_EDGES)).toBe(true);
    });
  });

  describe("FLEET_COLORS", () => {
    it("should have 10 colors", () => {
      expect(FLEET_COLORS).toHaveLength(10);
    });

    it("should contain valid hex color strings", () => {
      for (const color of FLEET_COLORS) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });
  });
});
