import { describe, it, expect } from "vitest";
import { buildExportArgs, buildMetadata } from "../commands/export.js";

describe("export", () => {
  describe("buildExportArgs", () => {
    it("should include both linestring and point geometry types", () => {
      const args = buildExportArgs({
        input: "/cache/region-roads.osm.pbf",
        output: "/cache/network.geojson",
      });
      const geomArg = args.find((a) => a.startsWith("--geometry-types="));
      expect(geomArg).toBeDefined();
      expect(geomArg).toContain("linestring");
      expect(geomArg).toContain("point");
    });

    it("should output geojson format", () => {
      const args = buildExportArgs({
        input: "/cache/in.osm.pbf",
        output: "/cache/out.geojson",
      });
      expect(args).toContain("--output-format=geojson");
    });

    it("should use basename for input and output paths", () => {
      const args = buildExportArgs({
        input: "/long/path/to/input.osm.pbf",
        output: "/long/path/to/output.geojson",
      });
      expect(args).toContain("input.osm.pbf");
      expect(args).not.toContain("/long/path/to/input.osm.pbf");
    });
  });

  describe("buildMetadata", () => {
    it("should include region, bbox, classes, and generatedAt", () => {
      const meta = buildMetadata({
        region: "cairo",
        bbox: [31.1, 29.9, 31.7, 30.2],
        classes: ["motorway", "trunk"],
      });
      expect(meta.region).toBe("cairo");
      expect(meta.bbox).toEqual([31.1, 29.9, 31.7, 30.2]);
      expect(meta.classes).toEqual(["motorway", "trunk"]);
      expect(meta.generatedAt).toBeDefined();
    });
  });
});
