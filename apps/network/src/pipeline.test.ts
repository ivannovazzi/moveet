import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureCollection } from "geojson";

const calls: string[] = [];

vi.mock("./docker.js", () => ({
  checkOsmiumAvailable: vi.fn(),
  osmium: vi.fn((args: string[], workdir: string) => {
    calls.push(`osmium ${args[0]}`);
    // The buildings export writes a GeoJSON sequence the tiler then reads.
    const out = args[args.indexOf("-o") + 1];
    if (args[0] === "export") {
      fs.writeFileSync(
        path.join(workdir, out),
        `${JSON.stringify({
          type: "Feature",
          properties: { building: "yes" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [9.65, 45.69],
                [9.6501, 45.69],
                [9.6501, 45.6901],
                [9.65, 45.69],
              ],
            ],
          },
        })}\n`
      );
    }
  }),
}));

vi.mock("./commands/download.js", async (orig) => ({
  ...(await orig<typeof import("./commands/download.js")>()),
  download: vi.fn(async (opts: { onProgress?: (r: number, t: number) => void }) => {
    calls.push("download");
    opts.onProgress?.(50, 100);
    return "";
  }),
}));
vi.mock("./commands/extract.js", () => ({ extract: vi.fn(() => calls.push("extract")) }));
vi.mock("./commands/filter.js", async (orig) => ({
  ...(await orig<typeof import("./commands/filter.js")>()),
  filter: vi.fn(() => calls.push("filter")),
}));

const ROADS: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { highway: "primary" },
      geometry: {
        type: "LineString",
        coordinates: [
          [9.65, 45.69],
          [9.66, 45.7],
          [9.67, 45.7],
        ],
      },
    },
    {
      type: "Feature",
      properties: { amenity: "cafe" },
      geometry: { type: "Point", coordinates: [9.7, 45.71] },
    },
  ],
};
let exported: FeatureCollection = ROADS;
vi.mock("./commands/export.js", () => ({
  exportNetwork: vi.fn((opts: { output: string }) => {
    calls.push("export");
    fs.writeFileSync(opts.output, JSON.stringify(exported));
    fs.writeFileSync(`${opts.output}.meta.json`, "{}");
  }),
}));

import { buildMap, featureStats, ProgressTracker, type BuildProgress } from "./pipeline.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "moveet-pipeline-"));
  fs.mkdirSync(path.join(dir, "cache"));
  fs.writeFileSync(path.join(dir, "cache", "europe-italy-latest.osm.pbf"), "pbf");
  calls.length = 0;
  exported = ROADS;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function options(extra: Partial<Parameters<typeof buildMap>[0]> = {}) {
  return {
    geofabrik: "europe/italy",
    bbox: [9.64, 45.68, 9.72, 45.72] as [number, number, number, number],
    cacheDir: path.join(dir, "cache"),
    workDir: path.join(dir, "work"),
    outDir: path.join(dir, "out"),
    regionName: "test",
    ...extra,
  };
}

describe("featureStats", () => {
  it("counts features and spans every coordinate", () => {
    expect(featureStats(ROADS)).toEqual({ featureCount: 2, bbox: [9.65, 45.69, 9.7, 45.71] });
    expect(featureStats({ type: "FeatureCollection", features: [] })).toEqual({
      featureCount: 0,
      bbox: null,
    });
  });
});

describe("ProgressTracker", () => {
  it("weights steps and renormalises when buildings are skipped", () => {
    const seen: BuildProgress[] = [];
    const t = new ProgressTracker(["download", "extract"], (p) => seen.push(p));
    t.report("download", 0.5);
    t.complete("download");
    t.report("extract", 1);
    expect(seen.map((p) => p.progress)).toEqual([0.364, 1]);
  });
});

describe("buildMap", () => {
  it("runs every step in order, reports monotonic progress and writes the outputs", async () => {
    const seen: BuildProgress[] = [];
    const result = await buildMap(options({ onProgress: (p) => seen.push(p) }));

    expect(calls).toEqual([
      "download",
      "extract",
      "filter",
      "export",
      "osmium tags-filter",
      "osmium export",
    ]);
    expect(result).toMatchObject({ featureCount: 2, buildingCount: 1 });
    expect(result.validation.passed).toBe(true);
    expect(fs.existsSync(path.join(dir, "out", "network.geojson"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "out", "network.geojson.meta.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "out", "buildings", "index.json"))).toBe(true);

    const progress = seen.map((p) => p.progress);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(1);
    expect(new Set(seen.map((p) => p.step))).toEqual(
      new Set(["download", "extract", "filter", "export", "prune", "validate", "buildings"])
    );
    expect(seen.find((p) => p.bytesDownloaded !== undefined)).toMatchObject({
      bytesDownloaded: 50,
      totalBytes: 100,
    });
  });

  it("skips buildings when asked", async () => {
    const seen: BuildProgress[] = [];
    const result = await buildMap(options({ buildings: false, onProgress: (p) => seen.push(p) }));
    expect(result.buildingCount).toBeNull();
    expect(calls).not.toContain("osmium export");
    expect(fs.existsSync(path.join(dir, "out", "buildings"))).toBe(false);
    expect(seen.at(-1)).toEqual({ step: "validate", progress: 1 });
  });

  it("fails when the area has no roads", async () => {
    exported = { type: "FeatureCollection", features: [] };
    await expect(buildMap(options())).rejects.toThrow(/No roads/);
  });
});
