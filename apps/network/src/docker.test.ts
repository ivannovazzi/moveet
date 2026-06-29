import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from "child_process";
import { buildOsmiumArgs, osmium } from "./docker.js";

const mockExec = vi.mocked(execFileSync);

beforeEach(() => {
  mockExec.mockReset();
  // checkOsmiumAvailable caches the result at module scope; reset so the
  // availability tests below each see a fresh probe.
  vi.resetModules();
});

describe("buildOsmiumArgs", () => {
  it("resolves file arguments relative to the workdir, leaving flags untouched", () => {
    const args = buildOsmiumArgs(
      ["extract", "--bbox", "1,2,3,4", "input.osm.pbf", "-o", "out.osm.pbf"],
      "/abs/workdir"
    );
    expect(args).toEqual([
      "extract",
      "--bbox",
      "1,2,3,4",
      "/abs/workdir/input.osm.pbf",
      "-o",
      "/abs/workdir/out.osm.pbf",
    ]);
  });

  it("resolves geojson and json outputs too", () => {
    const args = buildOsmiumArgs(["export", "roads.osm.pbf", "-o", "out.geojson"], "/w");
    expect(args).toContain("/w/roads.osm.pbf");
    expect(args).toContain("/w/out.geojson");
  });

  it("does not mangle a path containing spaces", () => {
    const args = buildOsmiumArgs(["export", "my roads.osm.pbf"], "/a b/work");
    expect(args).toContain("/a b/work/my roads.osm.pbf");
  });
});

describe("osmium", () => {
  it("invokes osmium via execFileSync without a shell", () => {
    mockExec.mockReturnValue(Buffer.from(""));
    osmium(["export", "in.osm.pbf", "-o", "out.geojson"], "/w");
    expect(mockExec).toHaveBeenCalledWith(
      "osmium",
      ["export", "/w/in.osm.pbf", "-o", "/w/out.geojson"],
      { stdio: "inherit" }
    );
  });
});

describe("checkOsmiumAvailable", () => {
  it("does not throw when osmium is available", async () => {
    mockExec.mockReturnValue(Buffer.from("osmium version 1.16.0"));
    const { checkOsmiumAvailable } = await import("./docker.js");
    expect(() => checkOsmiumAvailable()).not.toThrow();
  });

  it("throws a clear error when osmium is not available", async () => {
    mockExec.mockImplementation(() => {
      throw new Error("command not found: osmium");
    });
    const { checkOsmiumAvailable } = await import("./docker.js");
    expect(() => checkOsmiumAvailable()).toThrow(/osmium-tool is not available/i);
  });
});
