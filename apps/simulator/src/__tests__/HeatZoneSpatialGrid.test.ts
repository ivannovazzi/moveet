import { describe, it, expect, beforeEach, vi } from "vitest";
import { HeatZoneManager } from "../modules/HeatZoneManager";
import type { Node, Edge, HeatZone } from "../types";

/**
 * Helper: builds a simple square polygon in [lon, lat] (GeoJSON) order,
 * centred on the given [lat, lon] position with the given half-size in degrees.
 */
function makeSquarePolygon(
  centerLat: number,
  centerLon: number,
  halfSize: number
): number[][] {
  const minLon = centerLon - halfSize;
  const maxLon = centerLon + halfSize;
  const minLat = centerLat - halfSize;
  const maxLat = centerLat + halfSize;
  // GeoJSON winding: [lon, lat]
  return [
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
    [minLon, minLat], // closed ring
  ];
}

/**
 * Injects zones directly into a HeatZoneManager, bypassing generateHeatedZones
 * (which uses turf and randomness). Uses the private zones + buildSpatialGrid
 * via type coercion so tests can be deterministic.
 */
function injectZones(manager: HeatZoneManager, zones: HeatZone[]): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = manager as any;
  m.zones = zones;
  m.buildSpatialGrid();
}

describe("HeatZoneManager — spatial grid", () => {
  let manager: HeatZoneManager;

  beforeEach(() => {
    manager = new HeatZoneManager();
  });

  // ── Grid build correctness ──────────────────────────────────────────────

  describe("buildSpatialGrid", () => {
    it("should populate the grid after zone injection", () => {
      const zone: HeatZone = {
        polygon: makeSquarePolygon(1.0, 2.0, 0.002),
        intensity: 0.5,
        timestamp: new Date().toISOString(),
      };
      injectZones(manager, [zone]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const grid: Map<string, HeatZone[]> = (manager as any).spatialGrid;
      expect(grid.size).toBeGreaterThan(0);

      // The zone's bounding box spans a small area; at least one cell must contain it
      let found = false;
      for (const cell of grid.values()) {
        if (cell.includes(zone)) {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    });

    it("should clear the grid when zones are empty", () => {
      // First populate
      injectZones(manager, [
        {
          polygon: makeSquarePolygon(1.0, 2.0, 0.002),
          intensity: 0.5,
          timestamp: new Date().toISOString(),
        },
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((manager as any).spatialGrid.size).toBeGreaterThan(0);

      // Then clear
      injectZones(manager, []);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((manager as any).spatialGrid.size).toBe(0);
    });

    it("should place a zone into all grid cells its bounding box overlaps", () => {
      // Zone that spans multiple grid cells (cell size = 0.005)
      const zone: HeatZone = {
        polygon: makeSquarePolygon(1.0, 2.0, 0.008), // 0.016 degrees wide -> at least 3 cells
        intensity: 0.7,
        timestamp: new Date().toISOString(),
      };
      injectZones(manager, [zone]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const grid: Map<string, HeatZone[]> = (manager as any).spatialGrid;

      // Count cells containing this zone
      let cellCount = 0;
      for (const cell of grid.values()) {
        if (cell.includes(zone)) cellCount++;
      }
      // 0.016 degrees / 0.005 cell size ~ 3.2 cells per axis -> at least 3x3 = 9 cells
      expect(cellCount).toBeGreaterThanOrEqual(9);
    });
  });

  // ── Point-in-zone detection (deterministic polygons) ────────────────────

  describe("isPositionInHeatZone with injected zones", () => {
    it("should return true for a position clearly inside a zone", () => {
      injectZones(manager, [
        {
          polygon: makeSquarePolygon(10.0, 20.0, 0.01),
          intensity: 0.5,
          timestamp: new Date().toISOString(),
        },
      ]);
      // Center of the zone
      expect(manager.isPositionInHeatZone([10.0, 20.0])).toBe(true);
    });

    it("should return false for a position clearly outside all zones", () => {
      injectZones(manager, [
        {
          polygon: makeSquarePolygon(10.0, 20.0, 0.01),
          intensity: 0.5,
          timestamp: new Date().toISOString(),
        },
      ]);
      // Far away
      expect(manager.isPositionInHeatZone([50.0, 50.0])).toBe(false);
    });

    it("should return false when no zones exist", () => {
      injectZones(manager, []);
      expect(manager.isPositionInHeatZone([10.0, 20.0])).toBe(false);
    });

    it("should handle positions near zone boundaries correctly", () => {
      const halfSize = 0.01;
      injectZones(manager, [
        {
          polygon: makeSquarePolygon(10.0, 20.0, halfSize),
          intensity: 0.5,
          timestamp: new Date().toISOString(),
        },
      ]);

      // Just inside the southern edge
      expect(manager.isPositionInHeatZone([10.0 - halfSize + 0.0001, 20.0])).toBe(true);
      // Just outside the southern edge
      expect(manager.isPositionInHeatZone([10.0 - halfSize - 0.001, 20.0])).toBe(false);
      // Just inside the eastern edge
      expect(manager.isPositionInHeatZone([10.0, 20.0 + halfSize - 0.0001])).toBe(true);
      // Just outside the eastern edge
      expect(manager.isPositionInHeatZone([10.0, 20.0 + halfSize + 0.001])).toBe(false);
    });

    it("should detect position inside any of multiple overlapping zones", () => {
      // Two overlapping zones at the same center
      injectZones(manager, [
        {
          polygon: makeSquarePolygon(10.0, 20.0, 0.005),
          intensity: 0.3,
          timestamp: new Date().toISOString(),
        },
        {
          polygon: makeSquarePolygon(10.0, 20.0, 0.01),
          intensity: 0.7,
          timestamp: new Date().toISOString(),
        },
      ]);

      // Center — inside both
      expect(manager.isPositionInHeatZone([10.0, 20.0])).toBe(true);
      // Inside only the larger zone
      expect(manager.isPositionInHeatZone([10.0 + 0.007, 20.0])).toBe(true);
      // Outside both
      expect(manager.isPositionInHeatZone([10.0 + 0.02, 20.0])).toBe(false);
    });

    it("should handle non-overlapping zones correctly", () => {
      injectZones(manager, [
        {
          polygon: makeSquarePolygon(10.0, 20.0, 0.005),
          intensity: 0.3,
          timestamp: new Date().toISOString(),
        },
        {
          polygon: makeSquarePolygon(30.0, 40.0, 0.005),
          intensity: 0.7,
          timestamp: new Date().toISOString(),
        },
      ]);

      expect(manager.isPositionInHeatZone([10.0, 20.0])).toBe(true);
      expect(manager.isPositionInHeatZone([30.0, 40.0])).toBe(true);
      expect(manager.isPositionInHeatZone([20.0, 30.0])).toBe(false);
    });
  });

  // ── Grid rebuild on regeneration ────────────────────────────────────────

  describe("grid rebuild", () => {
    it("should rebuild the grid when zones change", () => {
      // First set of zones
      injectZones(manager, [
        {
          polygon: makeSquarePolygon(10.0, 20.0, 0.005),
          intensity: 0.5,
          timestamp: new Date().toISOString(),
        },
      ]);
      expect(manager.isPositionInHeatZone([10.0, 20.0])).toBe(true);
      expect(manager.isPositionInHeatZone([30.0, 40.0])).toBe(false);

      // Replace with a different zone
      injectZones(manager, [
        {
          polygon: makeSquarePolygon(30.0, 40.0, 0.005),
          intensity: 0.5,
          timestamp: new Date().toISOString(),
        },
      ]);
      // Old position should no longer be in a zone
      expect(manager.isPositionInHeatZone([10.0, 20.0])).toBe(false);
      // New position should be in a zone
      expect(manager.isPositionInHeatZone([30.0, 40.0])).toBe(true);
    });

    it("should rebuild grid via generateHeatedZones", () => {
      const mockNodes: Node[] = [
        { id: "n1", coordinates: [45.5, -73.5], connections: [] as Edge[] },
        { id: "n2", coordinates: [45.501, -73.501], connections: [] as Edge[] },
      ];
      const mockEdges: Edge[] = [
        {
          id: "e1",
          streetId: "s1",
          start: mockNodes[0],
          end: mockNodes[1],
          distance: 0.1,
          bearing: 45,
          highway: "residential",
          maxSpeed: 30,
          surface: "unknown",
          oneway: false,
        },
      ];
      mockNodes[0].connections = [mockEdges[0]];
      mockNodes[1].connections = [mockEdges[0]];

      manager.generateHeatedZones(mockEdges, mockNodes, {
        count: 2,
        minRadius: 0.5,
        maxRadius: 1.0,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const grid: Map<string, HeatZone[]> = (manager as any).spatialGrid;
      expect(grid.size).toBeGreaterThan(0);

      // Regenerate — grid should be rebuilt (not accumulate old entries)
      manager.generateHeatedZones(mockEdges, mockNodes, {
        count: 1,
        minRadius: 0.1,
        maxRadius: 0.2,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gridAfter: Map<string, HeatZone[]> = (manager as any).spatialGrid;
      // All entries in the grid should reference zones from the current generation
      const currentZones = manager.getZones();
      for (const cell of gridAfter.values()) {
        for (const zone of cell) {
          expect(currentZones).toContain(zone);
        }
      }
    });

    it("should clear grid when generateHeatedZones receives empty nodes", () => {
      // First populate with zones
      injectZones(manager, [
        {
          polygon: makeSquarePolygon(10.0, 20.0, 0.005),
          intensity: 0.5,
          timestamp: new Date().toISOString(),
        },
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((manager as any).spatialGrid.size).toBeGreaterThan(0);

      // Generate with empty nodes
      manager.generateHeatedZones([], [], { count: 3 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((manager as any).spatialGrid.size).toBe(0);
      expect(manager.getZones()).toHaveLength(0);
    });
  });

  // ── Performance: fewer PIP checks via spatial grid ──────────────────────

  describe("performance — fewer raycastPIP calls", () => {
    it("should not call raycastPIP for positions with no candidate zones", () => {
      // Zone at [10, 20], query at [50, 50] — different grid cell, zero candidates
      injectZones(manager, [
        {
          polygon: makeSquarePolygon(10.0, 20.0, 0.002),
          intensity: 0.5,
          timestamp: new Date().toISOString(),
        },
      ]);

      // Spy on the private raycastPIP method
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spy = vi.spyOn(manager as any, "raycastPIP");

      const result = manager.isPositionInHeatZone([50.0, 50.0]);
      expect(result).toBe(false);
      expect(spy).not.toHaveBeenCalled();

      spy.mockRestore();
    });

    it("should call raycastPIP only for candidate zones, not all zones", () => {
      // Two zones far apart
      const zoneA: HeatZone = {
        polygon: makeSquarePolygon(10.0, 20.0, 0.002),
        intensity: 0.3,
        timestamp: new Date().toISOString(),
      };
      const zoneB: HeatZone = {
        polygon: makeSquarePolygon(30.0, 40.0, 0.002),
        intensity: 0.7,
        timestamp: new Date().toISOString(),
      };
      injectZones(manager, [zoneA, zoneB]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spy = vi.spyOn(manager as any, "raycastPIP");

      // Query inside zone A — should only PIP-check zone A (1 call), not zone B
      manager.isPositionInHeatZone([10.0, 20.0]);
      expect(spy).toHaveBeenCalledTimes(1);

      spy.mockClear();

      // Query inside zone B — should only PIP-check zone B (1 call)
      manager.isPositionInHeatZone([30.0, 40.0]);
      expect(spy).toHaveBeenCalledTimes(1);

      spy.mockRestore();
    });

    it("should make zero raycastPIP calls when there are no zones", () => {
      injectZones(manager, []);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spy = vi.spyOn(manager as any, "raycastPIP");

      manager.isPositionInHeatZone([10.0, 20.0]);
      expect(spy).not.toHaveBeenCalled();

      spy.mockRestore();
    });

    it("should call raycastPIP for each overlapping zone in the same cell", () => {
      // Two overlapping zones at the same location — both are candidates
      const zoneA: HeatZone = {
        polygon: makeSquarePolygon(10.0, 20.0, 0.002),
        intensity: 0.3,
        timestamp: new Date().toISOString(),
      };
      const zoneB: HeatZone = {
        polygon: makeSquarePolygon(10.0, 20.0, 0.003),
        intensity: 0.7,
        timestamp: new Date().toISOString(),
      };
      injectZones(manager, [zoneA, zoneB]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spy = vi.spyOn(manager as any, "raycastPIP");

      // Position is inside zone A, so .some() short-circuits after 1 call
      manager.isPositionInHeatZone([10.0, 20.0]);
      expect(spy).toHaveBeenCalledTimes(1); // short-circuit on first match

      spy.mockClear();

      // Position outside zoneA but inside zoneB — needs 2 PIP checks
      // (just outside zoneA's 0.002 half-size but inside zoneB's 0.003)
      manager.isPositionInHeatZone([10.0 + 0.0025, 20.0]);
      expect(spy).toHaveBeenCalledTimes(2);

      spy.mockRestore();
    });
  });
});
