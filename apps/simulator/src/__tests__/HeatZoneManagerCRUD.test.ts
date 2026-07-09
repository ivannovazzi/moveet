import { describe, it, expect, beforeEach, vi } from "vitest";
import { HeatZoneManager, HeatZoneCapError } from "../modules/HeatZoneManager";
import { HEAT_ZONE_DEFAULTS } from "../constants";
import type { Node, Edge } from "../types";

/**
 * Builds a closed square ring in [lon, lat] (GeoJSON) order, centred on the
 * given [lat, lon] position with the given half-size in degrees.
 */
function makeSquarePolygon(centerLat: number, centerLon: number, halfSize: number): number[][] {
  const minLon = centerLon - halfSize;
  const maxLon = centerLon + halfSize;
  const minLat = centerLat - halfSize;
  const maxLat = centerLat + halfSize;
  return [
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
    [minLon, minLat],
  ];
}

/** Minimal mock network with a 3-connection intersection for generation. */
function makeMockNetwork(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    { id: "n1", coordinates: [45.5, -73.5], connections: [] as Edge[] },
    { id: "n2", coordinates: [45.501, -73.501], connections: [] as Edge[] },
    { id: "n3", coordinates: [45.502, -73.502], connections: [] as Edge[] },
    { id: "n4", coordinates: [45.503, -73.503], connections: [] as Edge[] },
  ];
  const mkEdge = (id: string, a: Node, b: Node): Edge => ({
    id,
    streetId: "s1",
    start: a,
    end: b,
    distance: 0.1,
    bearing: 45,
    highway: "residential",
    maxSpeed: 30,
    surface: "unknown",
    oneway: false,
  });
  const edges: Edge[] = [
    mkEdge("e1", nodes[0], nodes[3]),
    mkEdge("e2", nodes[1], nodes[3]),
    mkEdge("e3", nodes[2], nodes[3]),
  ];
  nodes[0].connections = [edges[0]];
  nodes[1].connections = [edges[1]];
  nodes[2].connections = [edges[2]];
  nodes[3].connections = [edges[0], edges[1], edges[2]];
  return { nodes, edges };
}

describe("HeatZoneManager — manual CRUD", () => {
  let manager: HeatZoneManager;

  beforeEach(() => {
    manager = new HeatZoneManager();
  });

  describe("addZone", () => {
    it("inserts a zone and returns a feature with id, timestamp and derived radius", () => {
      const feature = manager.addZone({
        polygon: makeSquarePolygon(10, 20, 0.01),
        intensity: 0.6,
      });

      expect(feature.type).toBe("Feature");
      expect(feature.properties.id).toBeTruthy();
      expect(feature.properties.intensity).toBe(0.6);
      expect(typeof feature.properties.timestamp).toBe("string");
      expect(feature.properties.radius).toBeGreaterThan(0);
      expect(manager.getZones()).toHaveLength(1);
    });

    it("indexes the new zone so isPositionInHeatZone finds a point inside it", () => {
      manager.addZone({ polygon: makeSquarePolygon(10, 20, 0.01), intensity: 0.5 });
      expect(manager.isPositionInHeatZone([10, 20])).toBe(true);
      expect(manager.isPositionInHeatZone([50, 50])).toBe(false);
    });

    it("honours a caller-provided id", () => {
      const feature = manager.addZone({
        polygon: makeSquarePolygon(10, 20, 0.01),
        intensity: 0.5,
        id: "fixed-id",
      });
      expect(feature.properties.id).toBe("fixed-id");
      expect(manager.getZoneById("fixed-id")).toBeDefined();
    });

    it("assigns unique ids across added zones", () => {
      const a = manager.addZone({ polygon: makeSquarePolygon(10, 20, 0.01), intensity: 0.5 });
      const b = manager.addZone({ polygon: makeSquarePolygon(30, 40, 0.01), intensity: 0.5 });
      expect(a.properties.id).not.toBe(b.properties.id);
    });

    it("returns a stable id across repeated exports", () => {
      const feature = manager.addZone({
        polygon: makeSquarePolygon(10, 20, 0.01),
        intensity: 0.5,
      });
      const exported = manager.exportHeatedZonesAsFeatures();
      expect(exported).toHaveLength(1);
      expect(exported[0].properties.id).toBe(feature.properties.id);
      // A second export must not mint a new id
      expect(manager.exportHeatedZonesAsFeatures()[0].properties.id).toBe(feature.properties.id);
    });
  });

  describe("updateZone", () => {
    it("updates intensity and returns the updated feature", () => {
      const { properties } = manager.addZone({
        polygon: makeSquarePolygon(10, 20, 0.01),
        intensity: 0.5,
      });
      const updated = manager.updateZone(properties.id, { intensity: 0.9 });
      expect(updated).not.toBeNull();
      expect(updated?.properties.intensity).toBe(0.9);
    });

    it("returns null for an unknown id", () => {
      expect(manager.updateZone("nope", { intensity: 0.9 })).toBeNull();
    });

    it("re-indexes the grid when geometry changes so the PIP hit moves", () => {
      const { properties } = manager.addZone({
        polygon: makeSquarePolygon(10, 20, 0.01),
        intensity: 0.5,
      });
      expect(manager.isPositionInHeatZone([10, 20])).toBe(true);

      manager.updateZone(properties.id, { polygon: makeSquarePolygon(30, 40, 0.01) });

      expect(manager.isPositionInHeatZone([10, 20])).toBe(false);
      expect(manager.isPositionInHeatZone([30, 40])).toBe(true);
    });
  });

  describe("removeZone", () => {
    it("removes the zone and its grid entries", () => {
      const { properties } = manager.addZone({
        polygon: makeSquarePolygon(10, 20, 0.01),
        intensity: 0.5,
      });
      expect(manager.isPositionInHeatZone([10, 20])).toBe(true);

      const removed = manager.removeZone(properties.id);

      expect(removed).toBe(true);
      expect(manager.getZones()).toHaveLength(0);
      expect(manager.isPositionInHeatZone([10, 20])).toBe(false);
    });

    it("returns false for an unknown id", () => {
      expect(manager.removeZone("nope")).toBe(false);
    });

    it("only removes the targeted zone, leaving others intact", () => {
      const a = manager.addZone({ polygon: makeSquarePolygon(10, 20, 0.01), intensity: 0.5 });
      manager.addZone({ polygon: makeSquarePolygon(30, 40, 0.01), intensity: 0.5 });

      manager.removeZone(a.properties.id);

      expect(manager.getZones()).toHaveLength(1);
      expect(manager.isPositionInHeatZone([10, 20])).toBe(false);
      expect(manager.isPositionInHeatZone([30, 40])).toBe(true);
    });
  });

  describe("clearZones", () => {
    it("empties zones and the grid", () => {
      manager.addZone({ polygon: makeSquarePolygon(10, 20, 0.01), intensity: 0.5 });
      manager.addZone({ polygon: makeSquarePolygon(30, 40, 0.01), intensity: 0.5 });

      manager.clearZones();

      expect(manager.getZones()).toHaveLength(0);
      expect(manager.isPositionInHeatZone([10, 20])).toBe(false);
      expect(manager.isPositionInHeatZone([30, 40])).toBe(false);
    });
  });

  describe("generateHeatedZones append semantics", () => {
    it("appends generated zones to existing ones instead of replacing them", () => {
      manager.addZone({ polygon: makeSquarePolygon(10, 20, 0.02), intensity: 0.5 });
      expect(manager.isPositionInHeatZone([10, 20])).toBe(true);

      const { nodes, edges } = makeMockNetwork();
      const before = manager.getZones().length;
      manager.generateHeatedZones(edges, nodes, { count: 3, minRadius: 0.2, maxRadius: 0.5 });

      // Count grew, and the manually-added zone survives the generation.
      expect(manager.getZones().length).toBeGreaterThan(before);
      expect(manager.isPositionInHeatZone([10, 20])).toBe(true);
    });

    it("leaves existing zones intact when generation gets no usable nodes", () => {
      manager.addZone({ polygon: makeSquarePolygon(10, 20, 0.02), intensity: 0.5 });

      manager.generateHeatedZones([], [], { count: 3 });

      expect(manager.getZones()).toHaveLength(1);
      expect(manager.isPositionInHeatZone([10, 20])).toBe(true);
    });
  });

  describe("total-zone cap (MAX_TOTAL)", () => {
    function fillToCap(): void {
      for (let i = 0; i < HEAT_ZONE_DEFAULTS.MAX_TOTAL; i++) {
        manager.addZone({ polygon: makeSquarePolygon(i * 0.1, 20, 0.001), intensity: 0.5 });
      }
    }

    it("addZone throws a typed cap error once at the cap", () => {
      fillToCap();
      expect(manager.getZones()).toHaveLength(HEAT_ZONE_DEFAULTS.MAX_TOTAL);
      expect(() =>
        manager.addZone({ polygon: makeSquarePolygon(500, 20, 0.001), intensity: 0.5 })
      ).toThrow(HeatZoneCapError);
      // Rejected add must not have grown the list.
      expect(manager.getZones()).toHaveLength(HEAT_ZONE_DEFAULTS.MAX_TOTAL);
    });

    it("addZone still works below the cap", () => {
      manager.addZone({ polygon: makeSquarePolygon(10, 20, 0.001), intensity: 0.5 });
      expect(manager.getZones()).toHaveLength(1);
    });

    it("generateHeatedZones/seed tops out at MAX_TOTAL and never grows past it", () => {
      const { nodes, edges } = makeMockNetwork();
      manager.generateHeatedZones(edges, nodes, { count: HEAT_ZONE_DEFAULTS.MAX_TOTAL + 50 });
      expect(manager.getZones().length).toBe(HEAT_ZONE_DEFAULTS.MAX_TOTAL);

      // Seeding again once at the cap appends nothing (no error).
      manager.generateHeatedZones(edges, nodes, { count: 50 });
      expect(manager.getZones().length).toBe(HEAT_ZONE_DEFAULTS.MAX_TOTAL);
    });
  });

  describe("radius caching", () => {
    it("caches radius on add and does not recompute it on a plain export", () => {
      const spy = vi.spyOn(manager as unknown as { deriveRadius: () => number }, "deriveRadius");
      const feature = manager.addZone({
        polygon: makeSquarePolygon(10, 20, 0.01),
        intensity: 0.5,
      });
      expect(feature.properties.radius).toBeGreaterThan(0);

      spy.mockClear();
      const exported = manager.exportHeatedZonesAsFeatures();
      expect(exported[0].properties.radius).toBe(feature.properties.radius);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("recomputes the cached radius when geometry changes on update", () => {
      const feature = manager.addZone({
        polygon: makeSquarePolygon(10, 20, 0.01),
        intensity: 0.5,
      });
      const smallRadius = feature.properties.radius;

      const updated = manager.updateZone(feature.properties.id, {
        polygon: makeSquarePolygon(10, 20, 0.05),
      });
      expect(updated?.properties.radius).toBeGreaterThan(smallRadius);
      expect(manager.exportHeatedZonesAsFeatures()[0].properties.radius).toBe(
        updated?.properties.radius
      );
    });

    it("leaves the radius unchanged when only intensity is updated", () => {
      const feature = manager.addZone({
        polygon: makeSquarePolygon(10, 20, 0.01),
        intensity: 0.5,
      });
      const updated = manager.updateZone(feature.properties.id, { intensity: 0.9 });
      expect(updated?.properties.radius).toBe(feature.properties.radius);
    });
  });
});
