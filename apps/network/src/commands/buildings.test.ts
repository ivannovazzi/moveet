import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, it, expect } from "vitest";
import {
  BUILDINGS_INDEX_FILE,
  buildBuildingsExportArgs,
  buildBuildingsFilterArgs,
  parseSeqLine,
  tileBuildings,
  writeBuildingTiles,
} from "./buildings.js";
import { BuildingTileBuilder } from "./buildingTiles.js";

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moveet-buildings-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const feature = (lon: number, lat: number, tags: Record<string, string>) => ({
  type: "Feature",
  geometry: {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [lon, lat],
          [lon + 0.0001, lat],
          [lon + 0.0001, lat + 0.0001],
          [lon, lat + 0.0001],
          [lon, lat],
        ],
      ],
    ],
  },
  properties: tags,
});

describe("osmium args", () => {
  it("filters ways and relations tagged building", () => {
    const args = buildBuildingsFilterArgs({
      input: "/cache/nairobi.osm.pbf",
      output: "/cache/nairobi-buildings.osm.pbf",
    });
    expect(args).toEqual([
      "tags-filter",
      "nairobi.osm.pbf",
      "wr/building",
      "-o",
      "nairobi-buildings.osm.pbf",
      "--overwrite",
    ]);
  });

  it("exports polygons only, as a GeoJSON sequence", () => {
    const args = buildBuildingsExportArgs({
      input: "/cache/nairobi-buildings.osm.pbf",
      output: "/cache/nairobi-buildings.geojson",
    });
    expect(args).toContain("--geometry-types=polygon");
    expect(args).toContain("--output-format=geojsonseq");
    expect(args[args.indexOf("-o") + 1]).toBe("nairobi-buildings.geojson");
  });
});

describe("parseSeqLine", () => {
  it("strips the RS record separator and skips blank lines", () => {
    expect(parseSeqLine('\u001e{"a":1}')).toEqual({ a: 1 });
    expect(parseSeqLine("   ")).toBeNull();
  });
});

describe("tileBuildings + writeBuildingTiles", () => {
  it("streams a sequence file into tiles and writes them with an index", async () => {
    const dir = tmpDir();
    const seq = path.join(dir, "in.geojson");
    fs.writeFileSync(
      seq,
      [
        JSON.stringify(feature(36.82, -1.29, { building: "yes" })),
        JSON.stringify(feature(36.7, -1.4, { building: "apartments" })),
        "",
      ].join("\n")
    );
    const builder = await tileBuildings(seq, new BuildingTileBuilder());
    expect(builder.count).toBe(2);

    const out = path.join(dir, "buildings");
    // A stale tile from a previous run must not survive.
    fs.mkdirSync(path.join(out, "14", "1"), { recursive: true });
    fs.writeFileSync(path.join(out, "14", "1", "1.json"), "{}");

    const index = writeBuildingTiles(out, builder, "nairobi");
    expect(index.tiles).toHaveLength(2);
    expect(fs.existsSync(path.join(out, "14", "1", "1.json"))).toBe(false);
    for (const key of index.tiles) {
      const tile = JSON.parse(fs.readFileSync(path.join(out, "14", `${key}.json`), "utf8"));
      expect(tile.n).toBe(1);
    }
    const written = JSON.parse(fs.readFileSync(path.join(out, BUILDINGS_INDEX_FILE), "utf8"));
    expect(written.buildings).toBe(2);
    expect(written.region).toBe("nairobi");
  });
});
