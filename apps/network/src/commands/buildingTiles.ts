import { resolveHeight, type BuildingTags } from "./buildingHeight.js";

/**
 * Compact, tiled building footprints for the simulator's `GET /buildings`.
 *
 * A city has hundreds of thousands of buildings (Nairobi: ~620k, 157 MB as
 * GeoJSON), far too much to ship to the browser in one piece. Footprints are
 * bucketed into Web Mercator tiles at {@link BUILDING_TILE_ZOOM} (by ring
 * centroid, so every building lands in exactly one tile and is never clipped)
 * and the UI fetches only the tiles in view, only at street zoom.
 *
 * Each tile is one small JSON document:
 *
 *   { "o": [ox, oy], "n": <count>, "b": [h, k, x0, y0, dx1, dy1, ..., h, k, ...] }
 *
 * - Coordinates are integers in units of 1 / {@link COORD_SCALE} degrees
 *   (about 0.1 m), `o` is the tile's south-west corner in those units.
 * - `b` is a single flat number array, one record per building: the height in
 *   decimetres, the vertex count `k`, the first vertex relative to `o`, then
 *   each further vertex as a delta from the previous one. The ring is open (the
 *   closing vertex is dropped; the renderer closes it).
 *
 * A flat numeric array keeps `JSON.parse` fast and allocation-light in the
 * browser, and the delta encoding keeps most numbers to two or three digits.
 * Only the outer ring of each polygon is kept: holes (courtyards) are under
 * 0.2% of rings and an extruded block reads the same without them.
 */

export const BUILDING_TILE_ZOOM = 14;
export const COORD_SCALE = 1e6;
export const BUILDINGS_FORMAT_VERSION = 1;

export type LonLat = readonly [number, number];

export interface BuildingTile {
  /** South-west corner, in 1 / COORD_SCALE degrees. */
  o: [number, number];
  /** Number of buildings in `b`. */
  n: number;
  /** Flat building records, see the module comment. */
  b: number[];
}

export interface BuildingsIndex {
  version: number;
  zoom: number;
  scale: number;
  /** Data extent, [west, south, east, north] in degrees. */
  bbox: [number, number, number, number];
  buildings: number;
  /** Tiles that hold at least one building, as "x/y". */
  tiles: string[];
  region: string;
  source: string;
  generatedAt: string;
}

export function lonLatToTile(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  const clamp = (v: number) => Math.min(n - 1, Math.max(0, v));
  return [clamp(x), clamp(y)];
}

function tileToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

function tileToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/** A tile's south-west corner, quantized to 1 / COORD_SCALE degrees. */
export function tileOrigin(x: number, y: number, z: number): [number, number] {
  return [Math.round(tileToLon(x, z) * COORD_SCALE), Math.round(tileToLat(y + 1, z) * COORD_SCALE)];
}

/**
 * Quantize a ring and drop the closing vertex and any consecutive duplicates
 * the rounding produced. Returns null when fewer than three distinct vertices
 * remain (a degenerate footprint that would not extrude to anything).
 */
export function quantizeRing(ring: readonly LonLat[]): [number, number][] | null {
  const out: [number, number][] = [];
  for (const [lon, lat] of ring) {
    const q: [number, number] = [Math.round(lon * COORD_SCALE), Math.round(lat * COORD_SCALE)];
    const prev = out[out.length - 1];
    if (prev && prev[0] === q[0] && prev[1] === q[1]) continue;
    out.push(q);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out.length >= 3 ? out : null;
}

/** Append one building record (see the module comment) to `target`. */
export function encodeBuilding(
  target: number[],
  ring: readonly [number, number][],
  heightM: number,
  origin: readonly [number, number]
): void {
  target.push(Math.max(1, Math.round(heightM * 10)), ring.length);
  let px = origin[0];
  let py = origin[1];
  for (const [x, y] of ring) {
    target.push(x - px, y - py);
    px = x;
    py = y;
  }
}

interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

/** Outer rings of a Polygon or MultiPolygon; anything else yields none. */
export function outerRings(geometry: GeoJsonGeometry | null | undefined): LonLat[][] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates as LonLat[][];
    return rings.length > 0 ? [rings[0]] : [];
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as LonLat[][][]).filter((p) => p.length > 0).map((p) => p[0]);
  }
  return [];
}

/** Accumulates buildings into tiles. Feed it features, then read `tiles`. */
export class BuildingTileBuilder {
  readonly tiles = new Map<string, BuildingTile>();
  count = 0;
  skipped = 0;
  private west = Infinity;
  private south = Infinity;
  private east = -Infinity;
  private north = -Infinity;

  constructor(readonly zoom: number = BUILDING_TILE_ZOOM) {}

  add(feature: { geometry?: GeoJsonGeometry | null; properties?: BuildingTags | null }): void {
    const tags = feature.properties ?? {};
    if (tags.building === "no") return;
    const height = resolveHeight(tags);
    for (const raw of outerRings(feature.geometry)) {
      const ring = quantizeRing(raw);
      if (!ring) {
        this.skipped++;
        continue;
      }
      let sx = 0;
      let sy = 0;
      for (const [x, y] of ring) {
        sx += x;
        sy += y;
        this.west = Math.min(this.west, x);
        this.east = Math.max(this.east, x);
        this.south = Math.min(this.south, y);
        this.north = Math.max(this.north, y);
      }
      const [tx, ty] = lonLatToTile(
        sx / ring.length / COORD_SCALE,
        sy / ring.length / COORD_SCALE,
        this.zoom
      );
      const key = `${tx}/${ty}`;
      let tile = this.tiles.get(key);
      if (!tile) {
        tile = { o: tileOrigin(tx, ty, this.zoom), n: 0, b: [] };
        this.tiles.set(key, tile);
      }
      encodeBuilding(tile.b, ring, height, tile.o);
      tile.n++;
      this.count++;
    }
  }

  /** Data extent in degrees, or null when nothing was added. */
  bbox(): [number, number, number, number] | null {
    if (this.count === 0) return null;
    return [this.west, this.south, this.east, this.north].map((v) => v / COORD_SCALE) as [
      number,
      number,
      number,
      number,
    ];
  }

  index(region: string): BuildingsIndex {
    return {
      version: BUILDINGS_FORMAT_VERSION,
      zoom: this.zoom,
      scale: COORD_SCALE,
      bbox: this.bbox() ?? [0, 0, 0, 0],
      buildings: this.count,
      tiles: [...this.tiles.keys()].sort(),
      region,
      source: "OpenStreetMap contributors, ODbL",
      generatedAt: new Date().toISOString(),
    };
  }
}
