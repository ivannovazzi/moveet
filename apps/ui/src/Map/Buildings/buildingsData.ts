import type { ApiResponse } from "@/types";
import { HttpClient } from "@/utils/httpClient";
import { config } from "@/utils/config";
import { setBuildingsStatus } from "./buildingsStatus";

/**
 * Fetching and decoding the simulator's building tiles (`GET /buildings`,
 * `GET /buildings/:z/:x/:y`, produced by `apps/network`'s `buildings` command).
 *
 * Only `BuildingsLayer` imports this, and that layer is lazy-loaded and only
 * mounted while the Buildings toggle is on: with the toggle off nothing here is
 * downloaded, fetched or parsed.
 *
 * Tile format (see apps/network/src/commands/buildingTiles.ts): `o` is the
 * tile's south-west corner and `b` a flat array of records
 * `[heightDm, k, x0, y0, dx1, dy1, ...]` in 1 / `scale` degree units, the
 * first vertex relative to `o` and the rest as deltas.
 */

export interface BuildingsIndex {
  version: number;
  zoom: number;
  scale: number;
  bbox: [number, number, number, number];
  buildings: number;
  tiles: string[];
  source: string;
}

export interface BuildingTile {
  o: [number, number];
  n: number;
  b: number[];
}

export interface Building {
  /** Flat [lon, lat, lon, lat, ...] open ring, for `positionFormat: "XY"`. */
  polygon: number[];
  /** Metres. */
  height: number;
}

type Get = <T>(path: string) => Promise<ApiResponse<T>>;

const defaultClient = new HttpClient(config.apiUrl);
const defaultGet: Get = (path) => defaultClient.get(path);

/** Decoded tiles kept in memory; a z14 view needs a dozen or so. */
export const MAX_CACHED_TILES = 48;

export function decodeTile(tile: BuildingTile, scale: number): Building[] {
  const out: Building[] = [];
  const { b } = tile;
  let i = 0;
  while (i + 1 < b.length) {
    const height = b[i++] / 10;
    const k = b[i++];
    let x = tile.o[0];
    let y = tile.o[1];
    const polygon = new Array<number>(k * 2);
    for (let v = 0; v < k; v++) {
      x += b[i++];
      y += b[i++];
      polygon[v * 2] = x / scale;
      polygon[v * 2 + 1] = y / scale;
    }
    out.push({ polygon, height });
  }
  return out;
}

export function lonLatToTile(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  const clamp = (v: number) => Math.min(n - 1, Math.max(0, v));
  return [clamp(x), clamp(y)];
}

/**
 * The index's tiles that intersect `bounds` ([west, south, east, north]),
 * nearest the view centre first and capped at `maxTiles`. A steeply pitched
 * camera reports bounds reaching towards the horizon; the cap keeps that from
 * turning into a hundred tile requests for buildings a few pixels tall.
 */
export function tilesInView(
  bounds: readonly [number, number, number, number],
  index: Pick<BuildingsIndex, "zoom" | "tiles">,
  maxTiles: number,
  available: ReadonlySet<string> = new Set(index.tiles)
): string[] {
  const [west, south, east, north] = bounds;
  const [x0, y0] = lonLatToTile(west, north, index.zoom);
  const [x1, y1] = lonLatToTile(east, south, index.zoom);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const found: { key: string; d: number }[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const key = `${x}/${y}`;
      if (available.has(key)) found.push({ key, d: (x - cx) ** 2 + (y - cy) ** 2 });
    }
  }
  found.sort((a, b) => a.d - b.d);
  return found.slice(0, maxTiles).map((t) => t.key);
}

let indexPromise: Promise<BuildingsIndex | null> | null = null;
const tileCache = new Map<string, Promise<Building[]>>();

/**
 * Fetch the building index once per session. Resolves null (and marks the
 * status `unavailable`) when the simulator has no building data or cannot be
 * reached; a failure is not cached, so turning the toggle off and on retries.
 */
export function loadBuildingsIndex(get: Get = defaultGet): Promise<BuildingsIndex | null> {
  if (indexPromise) return indexPromise;
  setBuildingsStatus("loading");
  indexPromise = get<BuildingsIndex>("/buildings").then((res) => {
    const index = res.data;
    if (!index || !Array.isArray(index.tiles) || index.tiles.length === 0) {
      indexPromise = null;
      setBuildingsStatus("unavailable");
      return null;
    }
    setBuildingsStatus("ready");
    return index;
  });
  return indexPromise;
}

/** Fetch and decode one tile, shared and cached across mounts (LRU). */
export function loadTile(
  key: string,
  index: Pick<BuildingsIndex, "zoom" | "scale">,
  get: Get = defaultGet
): Promise<Building[]> {
  const cached = tileCache.get(key);
  if (cached) {
    // Refresh recency.
    tileCache.delete(key);
    tileCache.set(key, cached);
    return cached;
  }
  const promise = get<BuildingTile>(`/buildings/${index.zoom}/${key}`).then((res) => {
    if (!res.data) {
      // Not cached: a transient failure should not blank the tile for good.
      tileCache.delete(key);
      return [];
    }
    return decodeTile(res.data, index.scale);
  });
  tileCache.set(key, promise);
  while (tileCache.size > MAX_CACHED_TILES) {
    const oldest = tileCache.keys().next().value;
    if (oldest === undefined) break;
    tileCache.delete(oldest);
  }
  return promise;
}

/** Test hook: forget the index, the tiles and the status. */
export function resetBuildingsData(): void {
  indexPromise = null;
  tileCache.clear();
  setBuildingsStatus("idle");
}
