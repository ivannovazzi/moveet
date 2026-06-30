import { describe, it, expect } from "vitest";
import { RoadNetwork } from "../modules/RoadNetwork";
import path from "path";

/**
 * Architecture review #5: the raw ~22 MB GeoJSON FeatureCollection must be
 * released after the graph is built, not retained forever on the instance.
 *
 * These tests prove (a) no field anywhere in the RoadNetwork object graph still
 * references the *full* parsed FeatureCollection, and (b) the getters that used
 * to re-scan that raw blob still return correct results from the eagerly-derived
 * structures.
 */
describe("RoadNetwork raw GeoJSON release (#5)", () => {
  const testGeojsonPath = path.join(__dirname, "fixtures", "test-network.geojson");

  /**
   * Recursively walks the object graph reachable from `root` and returns true
   * if any value is a FeatureCollection that still contains Point features.
   *
   * The full source collection contains Point features (POIs / signals); the
   * retained LineString-only `/network` view does NOT. So finding a
   * FeatureCollection with any Point feature means the raw blob leaked.
   */
  function retainsRawFeatureCollection(root: unknown): boolean {
    const seen = new Set<unknown>();
    const stack: unknown[] = [root];

    while (stack.length > 0) {
      const value = stack.pop();
      if (value === null || typeof value !== "object") continue;
      if (seen.has(value)) continue;
      seen.add(value);

      const obj = value as Record<string, unknown>;

      // A FeatureCollection that still holds Point geometry is the raw blob.
      if (
        obj.type === "FeatureCollection" &&
        Array.isArray(obj.features) &&
        obj.features.some(
          (f) =>
            f &&
            typeof f === "object" &&
            (f as { geometry?: { type?: string } }).geometry?.type === "Point"
        )
      ) {
        return true;
      }

      // Traverse own values, plus Map/Set/Array contents.
      if (value instanceof Map) {
        for (const v of value.values()) stack.push(v);
        for (const k of value.keys()) stack.push(k);
      } else if (value instanceof Set) {
        for (const v of value.values()) stack.push(v);
      } else if (Array.isArray(value)) {
        for (const v of value) stack.push(v);
      } else {
        for (const key of Object.keys(obj)) stack.push(obj[key]);
      }
    }
    return false;
  }

  it("does not retain the raw FeatureCollection (with Point features) after build", () => {
    const network = new RoadNetwork(testGeojsonPath);
    expect(retainsRawFeatureCollection(network)).toBe(false);
  });

  it("exposes no own/private field directly holding a FeatureCollection with POIs", () => {
    const network = new RoadNetwork(testGeojsonPath);
    // Walk only the instance's own enumerable + non-enumerable fields one level
    // deep — the old code retained a `data` field here.
    for (const key of Object.getOwnPropertyNames(network)) {
      const value = (network as unknown as Record<string, unknown>)[key];
      if (
        value &&
        typeof value === "object" &&
        (value as { type?: string }).type === "FeatureCollection"
      ) {
        const features = (value as { features?: unknown[] }).features ?? [];
        const hasPoint = features.some(
          (f) =>
            f &&
            typeof f === "object" &&
            (f as { geometry?: { type?: string } }).geometry?.type === "Point"
        );
        expect(hasPoint, `field "${key}" still holds the raw FeatureCollection`).toBe(false);
      }
    }
  });

  describe("data-backed getters still return correct results post-release", () => {
    it("getAllPOIs returns the Point-derived POIs", () => {
      const network = new RoadNetwork(testGeojsonPath);
      const pois = network.getAllPOIs();
      expect(pois.length).toBeGreaterThan(0);
      // Fixture contains a "Coffee Shop" shop POI.
      expect(pois.some((p) => p.type === "shop" && p.name === "Coffee Shop")).toBe(true);
    });

    it("getSpeedLimits returns signs derived from LineString maxspeed tags", () => {
      const network = new RoadNetwork(testGeojsonPath);
      const limits = network.getSpeedLimits();
      // Main Street has maxspeed "50".
      expect(limits.some((s) => s.speed === 50)).toBe(true);
      for (const sign of limits) {
        expect(sign.speed).toBeGreaterThan(0);
        expect(sign.coordinates).toHaveLength(2);
      }
    });

    it("getFeatures returns the LineString-only view with streetId stamped", () => {
      const network = new RoadNetwork(testGeojsonPath);
      const fc = network.getFeatures();
      expect(fc.type).toBe("FeatureCollection");
      expect(fc.features.length).toBeGreaterThan(0);
      for (const feature of fc.features) {
        expect(feature.geometry.type).toBe("LineString");
        // streetId is stamped onto every LineString during graph build.
        expect(feature.properties?.streetId).toBeDefined();
      }
    });

    it("getFeatures is stable (same reference) across calls", () => {
      const network = new RoadNetwork(testGeojsonPath);
      expect(network.getFeatures()).toBe(network.getFeatures());
    });
  });
});
