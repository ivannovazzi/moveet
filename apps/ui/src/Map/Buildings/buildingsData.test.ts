import { afterEach, describe, it, expect, vi } from "vitest";
import {
  MAX_CACHED_TILES,
  decodeTile,
  loadBuildingsIndex,
  loadTile,
  lonLatToTile,
  resetBuildingsData,
  tilesInView,
  type BuildingsIndex,
} from "./buildingsData";
import { getBuildingsStatus } from "./buildingsStatus";

const INDEX: BuildingsIndex = {
  version: 1,
  zoom: 14,
  scale: 1e6,
  bbox: [36.65, -1.45, 37.1, -1.15],
  buildings: 2,
  tiles: ["9867/8250", "9868/8250", "9000/9000"],
  source: "OpenStreetMap contributors, ODbL",
};

afterEach(() => resetBuildingsData());

describe("decodeTile", () => {
  it("decodes delta-encoded records into flat lon/lat rings and metres", () => {
    const buildings = decodeTile(
      {
        o: [36800000, -1300000],
        n: 2,
        // 7.3 m triangle, then a 12 m square.
        b: [73, 3, 10, 20, 20, 0, 0, 30, 120, 4, 0, 0, 100, 0, 0, 100, -100, 0],
      },
      1e6
    );
    expect(buildings).toHaveLength(2);
    expect(buildings[0].height).toBeCloseTo(7.3);
    expect(buildings[0].polygon).toEqual([
      36.80001, -1.29998, 36.80003, -1.29998, 36.80003, -1.29995,
    ]);
    expect(buildings[1].height).toBe(12);
    expect(buildings[1].polygon).toHaveLength(8);
    expect(buildings[1].polygon.slice(-2)).toEqual([36.8, -1.2999]);
  });

  it("decodes an empty tile to no buildings", () => {
    expect(decodeTile({ o: [0, 0], n: 0, b: [] }, 1e6)).toEqual([]);
  });
});

describe("tilesInView", () => {
  it("matches the slippy-map tile scheme the network CLI cuts", () => {
    expect(lonLatToTile(36.8219, -1.2921, 14)).toEqual([9867, 8250]);
  });

  it("returns only tiles that exist in the index and intersect the view", () => {
    const bounds: [number, number, number, number] = [36.81, -1.3, 36.84, -1.28];
    expect(tilesInView(bounds, INDEX, 10).sort()).toEqual(["9867/8250", "9868/8250"]);
  });

  it("caps the count, keeping the tiles nearest the view centre", () => {
    const tiles: string[] = [];
    for (let x = 9860; x < 9880; x++) for (let y = 8240; y < 8260; y++) tiles.push(`${x}/${y}`);
    const [west, north] = [36.65, -1.15];
    const [east, south] = [37.1, -1.45];
    const picked = tilesInView([west, south, east, north], { zoom: 14, tiles }, 4);
    expect(picked).toHaveLength(4);
    const [x0, y0] = lonLatToTile(west, north, 14);
    const [x1, y1] = lonLatToTile(east, south, 14);
    const dist = (key: string) => {
      const [x, y] = key.split("/").map(Number);
      return (x - (x0 + x1) / 2) ** 2 + (y - (y0 + y1) / 2) ** 2;
    };
    const farthestPicked = Math.max(...picked.map(dist));
    const nearestSkipped = Math.min(...tiles.filter((t) => !picked.includes(t)).map(dist));
    expect(farthestPicked).toBeLessThanOrEqual(nearestSkipped);
  });
});

describe("loadBuildingsIndex", () => {
  it("fetches once and marks the data ready", async () => {
    const get = vi.fn().mockResolvedValue({ data: INDEX });
    expect(getBuildingsStatus()).toBe("idle");

    const first = loadBuildingsIndex(get);
    expect(getBuildingsStatus()).toBe("loading");
    expect(await first).toEqual(INDEX);
    expect(await loadBuildingsIndex(get)).toEqual(INDEX);

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/buildings");
    expect(getBuildingsStatus()).toBe("ready");
  });

  it("marks the data unavailable on a 404, and retries on the next load", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: undefined, error: "No building data" })
      .mockResolvedValueOnce({ data: INDEX });

    expect(await loadBuildingsIndex(get)).toBeNull();
    expect(getBuildingsStatus()).toBe("unavailable");

    expect(await loadBuildingsIndex(get)).toEqual(INDEX);
    expect(get).toHaveBeenCalledTimes(2);
    expect(getBuildingsStatus()).toBe("ready");
  });

  it("treats an index with no tiles as unavailable", async () => {
    const get = vi.fn().mockResolvedValue({ data: { ...INDEX, tiles: [] } });
    expect(await loadBuildingsIndex(get)).toBeNull();
    expect(getBuildingsStatus()).toBe("unavailable");
  });
});

describe("loadTile", () => {
  const tile = { o: [36800000, -1300000], n: 1, b: [70, 3, 0, 0, 10, 0, 0, 10] };

  it("fetches the tile path at the index zoom and caches the decoded result", async () => {
    const get = vi.fn().mockResolvedValue({ data: tile });
    const a = await loadTile("9867/8250", INDEX, get);
    const b = await loadTile("9867/8250", INDEX, get);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/buildings/14/9867/8250");
    expect(a).toBe(b);
    expect(a[0].height).toBe(7);
  });

  it("does not cache a failed tile", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: undefined, error: "down" })
      .mockResolvedValueOnce({ data: tile });
    expect(await loadTile("1/1", INDEX, get)).toEqual([]);
    expect(await loadTile("1/1", INDEX, get)).toHaveLength(1);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used tile beyond the cache size", async () => {
    const get = vi.fn().mockResolvedValue({ data: tile });
    for (let i = 0; i <= MAX_CACHED_TILES; i++) await loadTile(`${i}/0`, INDEX, get);
    expect(get).toHaveBeenCalledTimes(MAX_CACHED_TILES + 1);
    await loadTile(`${MAX_CACHED_TILES}/0`, INDEX, get); // newest: still cached
    expect(get).toHaveBeenCalledTimes(MAX_CACHED_TILES + 1);
    await loadTile("0/0", INDEX, get); // oldest: evicted
    expect(get).toHaveBeenCalledTimes(MAX_CACHED_TILES + 2);
  });
});
