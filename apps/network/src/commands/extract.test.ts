import { describe, it, expect } from "vitest";
import { buildExtractArgs } from "./extract.js";

describe("buildExtractArgs", () => {
  it("builds correct osmium extract args", () => {
    const args = buildExtractArgs({
      input: "/data/africa-kenya-latest.osm.pbf",
      output: "/data/nairobi.osm.pbf",
      bbox: [36.65, -1.45, 37.1, -1.15],
    });
    expect(args[0]).toBe("extract");
    expect(args).toContain("--bbox");
    const bboxIdx = args.indexOf("--bbox");
    expect(args[bboxIdx + 1]).toMatch(/36\.65,-1\.45,37\.1,-1\.15/);
    expect(args).toContain("africa-kenya-latest.osm.pbf");
    expect(args).toContain("-o");
    const oIdx = args.indexOf("-o");
    expect(args[oIdx + 1]).toBe("nairobi.osm.pbf");
    expect(args).toContain("--overwrite");
  });
});
