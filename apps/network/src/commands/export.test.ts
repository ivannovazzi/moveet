import { describe, it, expect } from "vitest";
import { buildExportArgs, buildMetadata } from "./export.js";

describe("buildExportArgs", () => {
  it("builds correct osmium export args", () => {
    const args = buildExportArgs({
      input: "/data/nairobi-roads.osm.pbf",
      output: "/out/network.geojson",
    });
    expect(args[0]).toBe("export");
    expect(args[1]).toBe("nairobi-roads.osm.pbf");
    expect(args).toContain("--geometry-types=linestring");
    expect(args).toContain("--output-format=geojson");
    expect(args).toContain("--overwrite");
    const oIdx = args.indexOf("-o");
    expect(args[oIdx + 1]).toBe("network.geojson");
  });
});

describe("buildMetadata", () => {
  it("includes region, bbox, classes, and generatedAt", () => {
    const meta = buildMetadata({
      region: "nairobi",
      bbox: [36.65, -1.45, 37.1, -1.15],
      classes: ["primary", "secondary"],
    });
    expect(meta.region).toBe("nairobi");
    expect(meta.bbox).toEqual([36.65, -1.45, 37.1, -1.15]);
    expect(meta.classes).toContain("primary");
    expect(typeof meta.generatedAt).toBe("string");
    // generatedAt should be a valid ISO date string
    expect(() => new Date(meta.generatedAt)).not.toThrow();
  });
});
