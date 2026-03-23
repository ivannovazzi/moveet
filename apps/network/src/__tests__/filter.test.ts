import { describe, it, expect } from "vitest";
import { buildFilterArgs, DEFAULT_ROAD_CLASSES } from "../commands/filter.js";

describe("filter", () => {
  describe("DEFAULT_ROAD_CLASSES", () => {
    it("should include residential and living_street", () => {
      expect(DEFAULT_ROAD_CLASSES).toContain("residential");
      expect(DEFAULT_ROAD_CLASSES).toContain("living_street");
    });

    it("should include all major road types", () => {
      for (const cls of [
        "motorway",
        "trunk",
        "primary",
        "secondary",
        "tertiary",
        "unclassified",
      ]) {
        expect(DEFAULT_ROAD_CLASSES).toContain(cls);
      }
    });
  });

  describe("buildFilterArgs", () => {
    it("should produce w/ expressions for each road class", () => {
      const args = buildFilterArgs({
        input: "/cache/region.osm.pbf",
        output: "/cache/region-roads.osm.pbf",
      });
      expect(args[0]).toBe("tags-filter");
      for (const cls of DEFAULT_ROAD_CLASSES) {
        expect(args).toContain(`w/highway=${cls}`);
      }
      expect(args).toContain("w/junction=roundabout");
    });

    it("should include node filters for POIs", () => {
      const args = buildFilterArgs({
        input: "/cache/region.osm.pbf",
        output: "/cache/region-roads.osm.pbf",
      });
      expect(args).toContain("n/amenity");
      expect(args).toContain("n/shop");
      expect(args).toContain("n/leisure");
      expect(args).toContain("n/craft");
      expect(args).toContain("n/office");
    });

    it("should include node filters for traffic infrastructure", () => {
      const args = buildFilterArgs({
        input: "/cache/region.osm.pbf",
        output: "/cache/region-roads.osm.pbf",
      });
      expect(args).toContain("n/highway=traffic_signals");
      expect(args).toContain("n/highway=bus_stop");
    });

    it("should include relation filter for turn restrictions", () => {
      const args = buildFilterArgs({
        input: "/cache/region.osm.pbf",
        output: "/cache/region-roads.osm.pbf",
      });
      expect(args).toContain("r/type=restriction");
    });

    it("should accept custom road classes", () => {
      const args = buildFilterArgs({
        input: "/cache/region.osm.pbf",
        output: "/cache/region-roads.osm.pbf",
        classes: ["motorway", "trunk"],
      });
      expect(args).toContain("w/highway=motorway");
      expect(args).toContain("w/highway=trunk");
      expect(args).not.toContain("w/highway=primary");
      // Node and relation filters should still be present
      expect(args).toContain("n/amenity");
      expect(args).toContain("r/type=restriction");
    });
  });
});
