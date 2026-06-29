import { describe, it, expect } from "vitest";
import { buildFilterArgs, DEFAULT_ROAD_CLASSES } from "./filter.js";

describe("filter", () => {
  describe("DEFAULT_ROAD_CLASSES", () => {
    it("should include residential and living_street", () => {
      expect(DEFAULT_ROAD_CLASSES).toContain("residential");
      expect(DEFAULT_ROAD_CLASSES).toContain("living_street");
    });

    it("should include all major road types", () => {
      for (const cls of ["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified"]) {
        expect(DEFAULT_ROAD_CLASSES).toContain(cls);
      }
    });
  });

  describe("buildFilterArgs", () => {
    it("builds osmium tags-filter args with default road classes", () => {
      const args = buildFilterArgs({
        input: "/data/nairobi.osm.pbf",
        output: "/data/nairobi-roads.osm.pbf",
        classes: DEFAULT_ROAD_CLASSES,
      });
      expect(args[0]).toBe("tags-filter");
      expect(args[1]).toBe("nairobi.osm.pbf");
      // One w/highway= expression per class (osmium ~regex is broken in v1.16+)
      for (const cls of DEFAULT_ROAD_CLASSES) {
        expect(args).toContain(`w/highway=${cls}`);
      }
      expect(args).toContain("w/junction=roundabout");
      expect(args).toContain("-o");
      const oIdx = args.indexOf("-o");
      expect(args[oIdx + 1]).toBe("nairobi-roads.osm.pbf");
      expect(args).toContain("--overwrite");
    });

    it("uses basename for input and output paths", () => {
      const args = buildFilterArgs({
        input: "/long/path/to/region.osm.pbf",
        output: "/long/path/to/region-roads.osm.pbf",
      });
      expect(args).toContain("region.osm.pbf");
      expect(args).not.toContain("/long/path/to/region.osm.pbf");
    });

    it("includes node filters for POIs", () => {
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

    it("includes node filters for traffic infrastructure", () => {
      const args = buildFilterArgs({
        input: "/cache/region.osm.pbf",
        output: "/cache/region-roads.osm.pbf",
      });
      expect(args).toContain("n/highway=traffic_signals");
      expect(args).toContain("n/highway=bus_stop");
    });

    it("includes relation filter for turn restrictions", () => {
      const args = buildFilterArgs({
        input: "/cache/region.osm.pbf",
        output: "/cache/region-roads.osm.pbf",
      });
      expect(args).toContain("r/type=restriction");
    });

    it("respects custom road classes", () => {
      const args = buildFilterArgs({
        input: "/data/nairobi.osm.pbf",
        output: "/data/nairobi-roads.osm.pbf",
        classes: ["motorway", "primary"],
      });
      expect(args).toContain("w/highway=motorway");
      expect(args).toContain("w/highway=primary");
      expect(args).not.toContain("w/highway=residential");
      // Node and relation filters should still be present
      expect(args).toContain("n/amenity");
      expect(args).toContain("r/type=restriction");
    });
  });
});
