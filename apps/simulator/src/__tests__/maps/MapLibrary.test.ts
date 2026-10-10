import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MapLibrary,
  geoJsonStats,
  isValidMapId,
  slugifyMapId,
} from "../../modules/maps/MapLibrary";

const FIXTURES = path.join(__dirname, "..", "fixtures");
const SMALL = path.join(FIXTURES, "test-network.geojson");
const GRID = path.join(FIXTURES, "integration-network.geojson");
const BUNDLED = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "assets",
  "default-map",
  "network.geojson"
);

const tmpDirs: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moveet-maps-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("map ids", () => {
  it("accepts path-safe ids and rejects traversal", () => {
    expect(isValidMapId("nairobi")).toBe(true);
    expect(isValidMapId("new-york_2")).toBe(true);
    expect(isValidMapId("..")).toBe(false);
    expect(isValidMapId("a/b")).toBe(false);
    expect(isValidMapId("Nairobi")).toBe(false);
    expect(isValidMapId("")).toBe(false);
  });

  it("slugifies free-form names", () => {
    expect(slugifyMapId("New York City")).toBe("new-york-city");
    expect(slugifyMapId("../etc")).toBe("etc");
    expect(slugifyMapId("***")).toBe("map");
  });
});

describe("geoJsonStats", () => {
  it("counts features and computes the coordinate bbox", () => {
    const stats = geoJsonStats(JSON.parse(fs.readFileSync(GRID, "utf8")));
    expect(stats.featureCount).toBeGreaterThan(0);
    expect(stats.bbox).not.toBeNull();
    const [minLon, minLat, maxLon, maxLat] = stats.bbox!;
    expect(minLon).toBeLessThan(maxLon);
    expect(minLat).toBeLessThan(maxLat);
  });

  it("rejects non-FeatureCollections", () => {
    expect(() => geoJsonStats({ type: "Feature" })).toThrow(/FeatureCollection/);
  });
});

describe("MapLibrary", () => {
  it("imports a map with meta and lists it", () => {
    const library = new MapLibrary(tmp());
    const meta = library.importMap({
      id: "Grid",
      label: "Grid",
      networkPath: GRID,
      source: { type: "preset", name: "grid" },
    });
    expect(meta.id).toBe("grid");
    expect(meta.hasBuildings).toBe(false);
    expect(meta.sizes.networkBytes).toBe(fs.statSync(GRID).size);
    expect(meta.nodeCount).toBeNull();
    expect(fs.existsSync(library.networkPath("grid"))).toBe(true);
    expect(library.list().map((m) => m.id)).toEqual(["grid"]);
    expect(library.get("grid")?.label).toBe("Grid");
    // No staging directories left behind.
    expect(fs.readdirSync(library.root).filter((f) => f.startsWith("."))).toEqual([]);
  });

  it("makes ids unique and copies building tiles", () => {
    const root = tmp();
    const buildings = path.join(tmp(), "buildings");
    fs.mkdirSync(path.join(buildings, "14", "1"), { recursive: true });
    fs.writeFileSync(path.join(buildings, "index.json"), '{"tiles":["1/2"]}');
    fs.writeFileSync(path.join(buildings, "14", "1", "2.json"), "{}");

    const library = new MapLibrary(root);
    library.importMap({ id: "city", label: "A", networkPath: SMALL, source: { type: "bundled" } });
    const second = library.importMap({
      id: "city",
      label: "B",
      networkPath: GRID,
      buildingsDir: buildings,
      source: { type: "bundled" },
    });
    expect(second.id).toBe("city-2");
    expect(second.hasBuildings).toBe(true);
    expect(second.sizes.buildingsBytes).toBeGreaterThan(0);
    expect(library.buildingsDir("city-2")).toBe(path.join(root, "city-2", "buildings"));
    expect(library.buildingsDir("city")).toBeNull();
  });

  it("leaves nothing behind when the network is not valid GeoJSON", () => {
    const root = tmp();
    const bad = path.join(tmp(), "bad.geojson");
    fs.writeFileSync(bad, "{ not json");
    const library = new MapLibrary(root);
    expect(() =>
      library.importMap({ id: "bad", label: "Bad", networkPath: bad, source: { type: "bundled" } })
    ).toThrow();
    expect(library.list()).toEqual([]);
  });

  it("persists the active id and ignores one pointing at a missing map", () => {
    const root = tmp();
    const library = new MapLibrary(root);
    library.importMap({ id: "a", label: "A", networkPath: SMALL, source: { type: "bundled" } });
    library.importMap({ id: "b", label: "B", networkPath: GRID, source: { type: "bundled" } });
    library.setActiveId("b");
    expect(new MapLibrary(root).getActiveId()).toBe("b");
    expect(new MapLibrary(root).activeNetworkPath()).toBe(path.join(root, "b", "network.geojson"));

    library.remove("b");
    expect(library.getActiveId()).toBeNull();
    expect(() => library.setActiveId("b")).toThrow(/Unknown map/);
  });

  it("describes a map directory added by hand", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "manual"));
    fs.copyFileSync(GRID, path.join(root, "manual", "network.geojson"));
    const library = new MapLibrary(root);
    const meta = library.get("manual");
    expect(meta?.label).toBe("manual");
    expect(meta?.featureCount).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(root, "manual", "meta.json"))).toBe(true);
    expect(library.list().map((m) => m.id)).toEqual(["manual"]);
  });

  it("updates meta in place", () => {
    const library = new MapLibrary(tmp());
    library.importMap({ id: "a", label: "A", networkPath: SMALL, source: { type: "bundled" } });
    expect(library.updateMeta("a", { nodeCount: 42 })?.nodeCount).toBe(42);
    expect(library.get("a")?.nodeCount).toBe(42);
    expect(library.updateMeta("missing", { nodeCount: 1 })).toBeNull();
  });

  describe("initialize (migration)", () => {
    it("imports the pre-library network and buildings when the library is empty", () => {
      const legacyDir = tmp();
      const legacyNetwork = path.join(legacyDir, "network.geojson");
      fs.copyFileSync(GRID, legacyNetwork);
      const legacyBuildings = path.join(legacyDir, "buildings");
      fs.mkdirSync(legacyBuildings);
      fs.writeFileSync(path.join(legacyBuildings, "index.json"), "{}");

      const root = path.join(tmp(), "nested", "maps");
      const library = new MapLibrary(root);
      const active = library.initialize({
        legacyNetworkPath: legacyNetwork,
        legacyBuildingsDir: legacyBuildings,
        bundledNetworkPath: BUNDLED,
      });

      expect(active).toBe("imported");
      const meta = library.get("imported")!;
      expect(meta.source).toEqual({
        type: "import",
        from: path.relative(process.cwd(), legacyNetwork),
      });
      expect(meta.hasBuildings).toBe(true);
      expect(library.getActiveId()).toBe("imported");
      // The originals are copied, never moved.
      expect(fs.existsSync(legacyNetwork)).toBe(true);
      expect(fs.existsSync(legacyBuildings)).toBe(true);
    });

    it("falls back to the bundled default map when there is nothing to import", () => {
      const library = new MapLibrary(tmp());
      const active = library.initialize({
        legacyNetworkPath: path.join(tmp(), "missing.geojson"),
        bundledNetworkPath: BUNDLED,
      });
      expect(active).toBe("demo");
      expect(library.get("demo")?.source).toEqual({ type: "bundled" });
    });

    it("does not import again once the library has maps, and keeps the active choice", () => {
      const root = tmp();
      const library = new MapLibrary(root);
      library.importMap({ id: "a", label: "A", networkPath: SMALL, source: { type: "bundled" } });
      library.importMap({ id: "b", label: "B", networkPath: GRID, source: { type: "bundled" } });
      library.setActiveId("b");

      const active = new MapLibrary(root).initialize({
        legacyNetworkPath: GRID,
        bundledNetworkPath: BUNDLED,
      });
      expect(active).toBe("b");
      expect(library.list().map((m) => m.id)).toEqual(["a", "b"]);
    });

    it("throws a clear error when there is no map at all", () => {
      const library = new MapLibrary(tmp());
      expect(() => library.initialize({})).toThrow(/empty/);
    });
  });
});
