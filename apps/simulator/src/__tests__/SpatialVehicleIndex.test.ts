import { describe, it, expect } from "vitest";
import { SpatialVehicleIndex } from "../modules/SpatialVehicleIndex";
import { SPATIAL_GRID } from "../constants";

describe("SpatialVehicleIndex", () => {
  describe("grid cell assignment", () => {
    it("should place a vehicle in the correct grid cell", () => {
      const index = new SpatialVehicleIndex();
      index.update("v1", -1.286, 36.817);

      expect(index.size).toBe(1);
      expect(index.cellCount).toBe(1);
    });

    it("should place vehicles with the same cell coordinates in the same cell", () => {
      const index = new SpatialVehicleIndex();
      // Both coords are within the same cell (~500m)
      const cellSize = SPATIAL_GRID.CELL_SIZE;
      const baseLat = -1.286;
      const baseLng = 36.817;
      const tinyOffset = cellSize * 0.1;

      index.update("v1", baseLat, baseLng);
      index.update("v2", baseLat + tinyOffset, baseLng + tinyOffset);

      expect(index.size).toBe(2);
      expect(index.cellCount).toBe(1);
    });

    it("should place vehicles in different cells when far apart", () => {
      const index = new SpatialVehicleIndex();
      // These are far enough apart to be in different cells
      index.update("v1", -1.286, 36.817);
      index.update("v2", -1.3, 36.83); // >0.01 degrees away

      expect(index.size).toBe(2);
      expect(index.cellCount).toBe(2);
    });
  });

  describe("update / move between cells", () => {
    it("should be a no-op when vehicle stays in the same cell", () => {
      const index = new SpatialVehicleIndex();
      const cellSize = SPATIAL_GRID.CELL_SIZE;
      const tinyMove = cellSize * 0.01;

      index.update("v1", -1.286, 36.817);
      expect(index.cellCount).toBe(1);

      // Move slightly within the same cell
      index.update("v1", -1.286 + tinyMove, 36.817 + tinyMove);
      expect(index.size).toBe(1);
      expect(index.cellCount).toBe(1);
    });

    it("should move vehicle to new cell when it crosses a cell boundary", () => {
      const index = new SpatialVehicleIndex();
      const cellSize = SPATIAL_GRID.CELL_SIZE;

      index.update("v1", -1.286, 36.817);

      // Move to a position in a different cell
      index.update("v1", -1.286 + cellSize * 2, 36.817);

      expect(index.size).toBe(1);

      // Old cell should be cleaned up, new cell should have the vehicle
      const oldBbox = {
        minLat: -1.287,
        maxLat: -1.285,
        minLng: 36.816,
        maxLng: 36.818,
      };
      const newBbox = {
        minLat: -1.287 + cellSize * 2,
        maxLat: -1.285 + cellSize * 2,
        minLng: 36.816,
        maxLng: 36.818,
      };

      expect(oldBbox.minLat).not.toBe(newBbox.minLat); // sanity
      const oldResults = index.queryBbox(oldBbox);
      const newResults = index.queryBbox(newBbox);

      expect(oldResults.has("v1")).toBe(false);
      expect(newResults.has("v1")).toBe(true);
    });

    it("should clean up empty cells when a vehicle moves out", () => {
      const index = new SpatialVehicleIndex();
      const cellSize = SPATIAL_GRID.CELL_SIZE;

      index.update("v1", -1.286, 36.817);
      expect(index.cellCount).toBe(1);

      // Move far enough to land in a different cell
      index.update("v1", -1.286 + cellSize * 3, 36.817 + cellSize * 3);

      // Old cell was the only occupant, should be cleaned up
      expect(index.cellCount).toBe(1);
    });
  });

  describe("remove", () => {
    it("should remove a vehicle from the index", () => {
      const index = new SpatialVehicleIndex();
      index.update("v1", -1.286, 36.817);
      expect(index.size).toBe(1);

      index.remove("v1");
      expect(index.size).toBe(0);
      expect(index.cellCount).toBe(0);
    });

    it("should be a no-op for unknown vehicle IDs", () => {
      const index = new SpatialVehicleIndex();
      index.update("v1", -1.286, 36.817);

      index.remove("nonexistent");

      expect(index.size).toBe(1);
    });

    it("should not affect other vehicles in the same cell", () => {
      const index = new SpatialVehicleIndex();
      const tinyOffset = SPATIAL_GRID.CELL_SIZE * 0.1;

      index.update("v1", -1.286, 36.817);
      index.update("v2", -1.286 + tinyOffset, 36.817 + tinyOffset);
      expect(index.cellCount).toBe(1);

      index.remove("v1");

      expect(index.size).toBe(1);
      expect(index.cellCount).toBe(1); // cell still has v2

      const result = index.queryBbox({
        minLat: -1.29,
        maxLat: -1.28,
        minLng: 36.81,
        maxLng: 36.82,
      });
      expect(result.has("v1")).toBe(false);
      expect(result.has("v2")).toBe(true);
    });
  });

  describe("queryBbox", () => {
    it("should return vehicles inside the bbox", () => {
      const index = new SpatialVehicleIndex();
      index.update("v1", -1.286, 36.817); // Nairobi area

      const result = index.queryBbox({
        minLat: -2,
        maxLat: 0,
        minLng: 36,
        maxLng: 37,
      });

      expect(result.has("v1")).toBe(true);
    });

    it("should not return vehicles outside the bbox", () => {
      const index = new SpatialVehicleIndex();
      index.update("v1", -1.286, 36.817);
      index.update("v2", 5.0, 10.0); // far away

      const result = index.queryBbox({
        minLat: -2,
        maxLat: 0,
        minLng: 36,
        maxLng: 37,
      });

      expect(result.has("v1")).toBe(true);
      expect(result.has("v2")).toBe(false);
    });

    it("should return vehicles from all cells overlapping the bbox", () => {
      const index = new SpatialVehicleIndex();
      const cellSize = SPATIAL_GRID.CELL_SIZE;

      // Place vehicles in different cells within a wide bbox
      index.update("v1", -1.286, 36.817);
      index.update("v2", -1.286 + cellSize * 3, 36.817 + cellSize * 3);
      index.update("v3", -1.286 - cellSize * 2, 36.817 - cellSize * 2);

      const result = index.queryBbox({
        minLat: -1.4,
        maxLat: -1.2,
        minLng: 36.7,
        maxLng: 36.9,
      });

      expect(result.has("v1")).toBe(true);
      expect(result.has("v2")).toBe(true);
      expect(result.has("v3")).toBe(true);
    });

    it("should return empty set when bbox has no matching cells", () => {
      const index = new SpatialVehicleIndex();
      index.update("v1", -1.286, 36.817);

      const result = index.queryBbox({
        minLat: 50,
        maxLat: 51,
        minLng: 10,
        maxLng: 11,
      });

      expect(result.size).toBe(0);
    });

    it("should return empty set when index is empty", () => {
      const index = new SpatialVehicleIndex();

      const result = index.queryBbox({
        minLat: -2,
        maxLat: 0,
        minLng: 36,
        maxLng: 37,
      });

      expect(result.size).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("should handle vehicle on grid cell boundary", () => {
      const index = new SpatialVehicleIndex();
      const cellSize = SPATIAL_GRID.CELL_SIZE;

      // Place vehicle exactly on a cell boundary
      const boundaryLat = cellSize * Math.floor(-1.286 / cellSize);
      const boundaryLng = cellSize * Math.floor(36.817 / cellSize);
      index.update("v1", boundaryLat, boundaryLng);

      // Query that includes the boundary
      const result = index.queryBbox({
        minLat: boundaryLat - cellSize,
        maxLat: boundaryLat + cellSize,
        minLng: boundaryLng - cellSize,
        maxLng: boundaryLng + cellSize,
      });

      expect(result.has("v1")).toBe(true);
    });

    it("should handle zero-area bbox (single point)", () => {
      const index = new SpatialVehicleIndex();
      index.update("v1", -1.286, 36.817);

      // Point bbox that lands in the same cell as v1
      const result = index.queryBbox({
        minLat: -1.286,
        maxLat: -1.286,
        minLng: 36.817,
        maxLng: 36.817,
      });

      expect(result.has("v1")).toBe(true);
    });

    it("should handle negative coordinates", () => {
      const index = new SpatialVehicleIndex();
      index.update("v1", -33.87, -70.65); // negative lat and lng

      const result = index.queryBbox({
        minLat: -34,
        maxLat: -33,
        minLng: -71,
        maxLng: -70,
      });

      expect(result.has("v1")).toBe(true);
    });

    it("should handle custom cell size", () => {
      const index = new SpatialVehicleIndex(0.01); // ~1km cells

      // Both in the same 0.01-degree cell (row = floor(-1.286/0.01)=-129, col = floor(36.815/0.01)=3681)
      index.update("v1", -1.286, 36.815);
      index.update("v2", -1.288, 36.818); // within same 0.01 cell

      expect(index.cellCount).toBe(1);

      const result = index.queryBbox({
        minLat: -1.3,
        maxLat: -1.28,
        minLng: 36.81,
        maxLng: 36.83,
      });
      expect(result.size).toBe(2);
    });
  });

  describe("clear", () => {
    it("should remove all vehicles", () => {
      const index = new SpatialVehicleIndex();
      index.update("v1", -1.286, 36.817);
      index.update("v2", -1.3, 36.83);

      index.clear();

      expect(index.size).toBe(0);
      expect(index.cellCount).toBe(0);
    });
  });

  describe("performance", () => {
    it("should handle 1000+ vehicles efficiently", () => {
      const index = new SpatialVehicleIndex();
      const vehicleCount = 2000;

      // Place vehicles across Nairobi area (-1.35 to -1.2, 36.75 to 36.9)
      for (let i = 0; i < vehicleCount; i++) {
        const lat = -1.35 + Math.random() * 0.15;
        const lng = 36.75 + Math.random() * 0.15;
        index.update(`v${i}`, lat, lng);
      }

      expect(index.size).toBe(vehicleCount);

      // Query a small bbox (should return a subset)
      const start = performance.now();
      const smallResult = index.queryBbox({
        minLat: -1.3,
        maxLat: -1.28,
        minLng: 36.8,
        maxLng: 36.82,
      });
      const smallQueryMs = performance.now() - start;

      // Query the full area (should return all)
      const startFull = performance.now();
      const fullResult = index.queryBbox({
        minLat: -1.35,
        maxLat: -1.2,
        minLng: 36.75,
        maxLng: 36.9,
      });
      const fullQueryMs = performance.now() - startFull;

      // Small query should return a subset of all vehicles
      expect(smallResult.size).toBeLessThan(vehicleCount);
      expect(smallResult.size).toBeGreaterThan(0);

      // Full query should return all vehicles
      expect(fullResult.size).toBe(vehicleCount);

      // Both queries should be fast (< 50ms each)
      expect(smallQueryMs).toBeLessThan(50);
      expect(fullQueryMs).toBeLessThan(50);
    });

    it("should efficiently update moving vehicles", () => {
      const index = new SpatialVehicleIndex();
      const vehicleCount = 1000;

      // Initial placement
      for (let i = 0; i < vehicleCount; i++) {
        const lat = -1.35 + Math.random() * 0.15;
        const lng = 36.75 + Math.random() * 0.15;
        index.update(`v${i}`, lat, lng);
      }

      // Simulate movement (update all positions)
      const start = performance.now();
      for (let i = 0; i < vehicleCount; i++) {
        const lat = -1.35 + Math.random() * 0.15;
        const lng = 36.75 + Math.random() * 0.15;
        index.update(`v${i}`, lat, lng);
      }
      const updateMs = performance.now() - start;

      expect(index.size).toBe(vehicleCount);
      // All updates should complete fast (< 100ms)
      expect(updateMs).toBeLessThan(100);
    });
  });
});
