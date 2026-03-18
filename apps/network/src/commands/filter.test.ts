import { describe, it, expect } from "vitest";
import { buildFilterArgs, DEFAULT_ROAD_CLASSES } from "./filter.js";

describe("buildFilterArgs", () => {
  it("builds osmium tags-filter args with default road classes", () => {
    const args = buildFilterArgs({
      input: "/data/nairobi.osm.pbf",
      output: "/data/nairobi-roads.osm.pbf",
      classes: DEFAULT_ROAD_CLASSES,
    });
    expect(args[0]).toBe("tags-filter");
    expect(args[1]).toBe("nairobi.osm.pbf");
    const highwayArg = args.find((a) => a.startsWith("w/highway~"));
    expect(highwayArg).toBeDefined();
    expect(highwayArg).toContain("motorway");
    expect(highwayArg).toContain("unclassified");
    expect(highwayArg).toContain("residential");
    expect(args).toContain("w/junction=roundabout");
    expect(args).toContain("-o");
    const oIdx = args.indexOf("-o");
    expect(args[oIdx + 1]).toBe("nairobi-roads.osm.pbf");
    expect(args).toContain("--overwrite");
  });

  it("respects custom road classes", () => {
    const args = buildFilterArgs({
      input: "/data/nairobi.osm.pbf",
      output: "/data/nairobi-roads.osm.pbf",
      classes: ["motorway", "primary"],
    });
    const highwayArg = args.find((a) => a.startsWith("w/highway~"));
    expect(highwayArg).toContain("motorway");
    expect(highwayArg).toContain("primary");
    expect(highwayArg).not.toContain("residential");
  });
});
