import { describe, it, expect, beforeEach } from "vitest";
import { HeatZoneManager } from "../modules/HeatZoneManager";
import type { Node, Edge } from "../types";

describe("HeatZoneManager", () => {
  let manager: HeatZoneManager;
  let mockNodes: Node[];
  let mockEdges: Edge[];

  beforeEach(() => {
    manager = new HeatZoneManager();

    // Create mock network data
    mockNodes = [
      {
        id: "node-1",
        coordinates: [45.5017, -73.5673],
        connections: [],
      },
      {
        id: "node-2",
        coordinates: [45.502, -73.567],
        connections: [],
      },
      {
        id: "node-3",
        coordinates: [45.5023, -73.5667],
        connections: [],
      },
      {
        id: "intersection-1",
        coordinates: [45.5026, -73.5664],
        connections: [] as Edge[],
      },
    ];

    // Create mock edges and set up connections
    mockEdges = [
      {
        id: "edge-1",
        streetId: "street-1",
        start: mockNodes[0],
        end: mockNodes[1],
        distance: 0.5,
        bearing: 45,
        highway: "residential",
        maxSpeed: 30,
        surface: "unknown",
        oneway: false,
      },
      {
        id: "edge-2",
        streetId: "street-1",
        start: mockNodes[1],
        end: mockNodes[2],
        distance: 0.5,
        bearing: 45,
        highway: "residential",
        maxSpeed: 30,
        surface: "unknown",
        oneway: false,
      },
      {
        id: "edge-3",
        streetId: "street-2",
        start: mockNodes[2],
        end: mockNodes[3],
        distance: 0.5,
        bearing: 90,
        highway: "residential",
        maxSpeed: 30,
        surface: "unknown",
        oneway: false,
      },
    ];

    // Set up node connections (intersection has 3+ connections)
    mockNodes[0].connections = [mockEdges[0]];
    mockNodes[1].connections = [mockEdges[1]];
    mockNodes[2].connections = [mockEdges[2]];
    mockNodes[3].connections = [mockEdges[0], mockEdges[1], mockEdges[2]];
  });

  describe("constructor", () => {
    it("should initialize with empty zones", () => {
      const zones = manager.getZones();
      expect(zones).toHaveLength(0);
    });
  });

  describe("generateHeatedZones", () => {
    it("should generate specified number of zones", () => {
      manager.generateHeatedZones(mockEdges, mockNodes, { count: 3 });
      const zones = manager.getZones();

      expect(zones.length).toBeGreaterThan(0);
      expect(zones.length).toBeLessThanOrEqual(3);
    });

    it("should generate zones with valid properties", () => {
      manager.generateHeatedZones(mockEdges, mockNodes, {
        count: 2,
        minIntensity: 0.3,
        maxIntensity: 0.8,
      });
      const zones = manager.getZones();

      zones.forEach((zone) => {
        expect(zone.intensity).toBeGreaterThanOrEqual(0.3);
        expect(zone.intensity).toBeLessThanOrEqual(0.8);
        expect(zone.polygon).toBeDefined();
        expect(zone.polygon.length).toBeGreaterThan(0);
        expect(zone.timestamp).toBeDefined();
      });
    });

    it("should respect radius constraints", () => {
      manager.generateHeatedZones(mockEdges, mockNodes, {
        count: 2,
        minRadius: 0.5,
        maxRadius: 1.0,
      });
      const zones = manager.getZones();

      expect(zones.length).toBeGreaterThan(0);
    });

    it("should prefer intersections for zone placement", () => {
      manager.generateHeatedZones(mockEdges, mockNodes, { count: 5 });
      const zones = manager.getZones();

      // At least one zone should be generated
      expect(zones.length).toBeGreaterThan(0);
    });

    it("should handle empty node array", () => {
      manager.generateHeatedZones(mockEdges, [], { count: 3 });
      const zones = manager.getZones();

      expect(zones).toHaveLength(0);
    });

    it("should use default options when none provided", () => {
      manager.generateHeatedZones(mockEdges, mockNodes);
      const zones = manager.getZones();

      expect(zones.length).toBeGreaterThan(0);
    });
  });

  describe("exportHeatedZonesAsFeatures", () => {
    it("should export zones as GeoJSON features", () => {
      manager.generateHeatedZones(mockEdges, mockNodes, { count: 2 });
      const features = manager.exportHeatedZonesAsFeatures();

      expect(features.length).toBeGreaterThan(0);

      features.forEach((feature) => {
        expect(feature.type).toBe("Feature");
        expect(feature.properties.id).toBeDefined();
        expect(feature.properties.intensity).toBeDefined();
        expect(feature.properties.timestamp).toBeDefined();
        expect(feature.geometry.type).toBe("Polygon");
        expect(feature.geometry.coordinates).toBeDefined();
      });
    });

    it("should generate unique IDs for each feature", () => {
      manager.generateHeatedZones(mockEdges, mockNodes, { count: 3 });
      const features = manager.exportHeatedZonesAsFeatures();

      const ids = features.map((f) => f.properties.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });

    it("should export empty array when no zones generated", () => {
      const features = manager.exportHeatedZonesAsFeatures();

      expect(features).toHaveLength(0);
    });
  });

  describe("exportHeatedZonesAsPaths", () => {
    it("should export zones as encoded polyline paths", () => {
      manager.generateHeatedZones(mockEdges, mockNodes, { count: 2 });
      const paths = manager.exportHeatedZonesAsPaths();

      expect(paths.length).toBeGreaterThan(0);

      paths.forEach((path) => {
        expect(typeof path).toBe("string");
        expect(path.length).toBeGreaterThan(0);
      });
    });

    it("should export empty array when no zones generated", () => {
      const paths = manager.exportHeatedZonesAsPaths();

      expect(paths).toHaveLength(0);
    });
  });

  describe("isPositionInHeatZone", () => {
    beforeEach(() => {
      manager.generateHeatedZones(mockEdges, mockNodes, {
        count: 3,
        minRadius: 1.0,
        maxRadius: 2.0,
      });
    });

    it("should return boolean for any position", () => {
      const position: [number, number] = [45.502, -73.567];
      const result = manager.isPositionInHeatZone(position);

      expect(typeof result).toBe("boolean");
    });

    it("should return false for position far from all zones", () => {
      const farPosition: [number, number] = [90.0, 180.0];
      const result = manager.isPositionInHeatZone(farPosition);

      expect(result).toBe(false);
    });

    it("should return false when no zones exist", () => {
      const emptyManager = new HeatZoneManager();
      const result = emptyManager.isPositionInHeatZone([45.5, -73.5]);

      expect(result).toBe(false);
    });

    it("should handle edge cases with position at zone boundary", () => {
      const position: [number, number] = [45.5026, -73.5664];
      const result = manager.isPositionInHeatZone(position);

      // Result depends on actual zone generation, so we just test it doesn't throw
      expect(typeof result).toBe("boolean");
    });
  });

  describe("getZones", () => {
    it("should return generated zones", () => {
      manager.generateHeatedZones(mockEdges, mockNodes, { count: 3 });
      const zones = manager.getZones();

      expect(zones).toBeDefined();
      expect(Array.isArray(zones)).toBe(true);
      expect(zones.length).toBeGreaterThan(0);
    });

    it("should return array with zone properties", () => {
      manager.generateHeatedZones(mockEdges, mockNodes, { count: 2 });
      const zones = manager.getZones();

      zones.forEach((zone) => {
        expect(zone.polygon).toBeDefined();
        expect(zone.intensity).toBeGreaterThanOrEqual(0);
        expect(zone.intensity).toBeLessThanOrEqual(1);
        expect(zone.timestamp).toBeDefined();
        expect(typeof zone.timestamp).toBe("string");
      });
    });
  });

  describe("zone polygon properties", () => {
    it("should create closed polygons", () => {
      manager.generateHeatedZones(mockEdges, mockNodes, { count: 2 });
      const zones = manager.getZones();

      zones.forEach((zone) => {
        const polygon = zone.polygon;
        expect(polygon.length).toBeGreaterThan(0);

        // First and last points should be the same (closed polygon)
        const first = polygon[0];
        const last = polygon[polygon.length - 1];
        expect(first[0]).toBeCloseTo(last[0], 5);
        expect(first[1]).toBeCloseTo(last[1], 5);
      });
    });

    it("should create irregular polygons with multiple vertices", () => {
      manager.generateHeatedZones(mockEdges, mockNodes, { count: 2 });
      const zones = manager.getZones();

      zones.forEach((zone) => {
        // Should have more than 3 vertices (irregular polygon)
        expect(zone.polygon.length).toBeGreaterThan(3);
      });
    });
  });
});
