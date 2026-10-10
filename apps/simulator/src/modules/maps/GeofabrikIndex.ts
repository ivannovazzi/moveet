import fs from "fs";
import path from "path";
import type { GeofabrikRegion } from "@moveet/shared-types";
import logger from "../../utils/logger";
import { type Bbox, bboxAreaKm2 } from "./bbox";

/**
 * Geofabrik's official extract index (https://download.geofabrik.de/technical.html):
 * every downloadable region with its boundary polygon and `.pbf` URL.
 *
 * It answers two questions for map builds:
 *  - which extract(s) cover a bbox, smallest first (`GET /maps/geofabrik`);
 *  - whether a requested extract path is real: the index is the allowlist for
 *    `POST /maps`, so the simulator only ever downloads URLs it built from a
 *    path found here, never one a client supplied.
 *
 * The index (a few MB) is cached on disk and refreshed after a TTL; when a
 * refresh fails, the stale copy keeps serving.
 */

export const GEOFABRIK_INDEX_URL = "https://download.geofabrik.de/index-v1.json";
const PBF_URL = /^https:\/\/download\.geofabrik\.de\/(.+)-latest\.osm\.pbf$/;
const INDEX_FILE = "geofabrik-index.json";

type Ring = [number, number][];
type Polygon = Ring[];

interface IndexFeature {
  properties?: { id?: string; name?: string; urls?: { pbf?: string } };
  geometry?: { type?: string; coordinates?: unknown } | null;
}

interface IndexedRegion extends GeofabrikRegion {
  polygons: Polygon[];
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface GeofabrikIndexOptions {
  cacheDir: string;
  ttlMs: number;
  userAgent: string;
  fetch?: FetchLike;
  url?: string;
  now?: () => number;
}

/** Ray-casting point-in-ring test. */
function inRing([x, y]: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(point: [number, number], polygon: Polygon): boolean {
  if (!polygon[0] || !inRing(point, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => inRing(point, hole));
}

/**
 * Points along the bbox outline (corners and edge midpoints, plus the centre).
 * All of them inside a region's boundary is the containment test; sampling the
 * edges as well as the corners catches a boundary that dips into the box.
 */
function outlinePoints([w, s, e, n]: Bbox): [number, number][] {
  const points: [number, number][] = [];
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const x = w + ((e - w) * i) / steps;
    const y = s + ((n - s) * i) / steps;
    points.push([x, s], [x, n], [w, y], [e, y]);
  }
  points.push([(w + e) / 2, (s + n) / 2]);
  return points;
}

function polygonsOf(geometry: IndexFeature["geometry"]): Polygon[] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates as Polygon];
  if (geometry.type === "MultiPolygon") return geometry.coordinates as Polygon[];
  return [];
}

/** Parses Geofabrik's `index-v1.json` into regions with a path, bbox and area. */
export function parseGeofabrikIndex(raw: string): IndexedRegion[] {
  const data = JSON.parse(raw) as { features?: IndexFeature[] };
  if (!Array.isArray(data.features)) throw new Error("Geofabrik index has no features");
  const regions: IndexedRegion[] = [];
  for (const feature of data.features) {
    const url = feature.properties?.urls?.pbf;
    const match = url ? PBF_URL.exec(url) : null;
    const polygons = polygonsOf(feature.geometry);
    if (!url || !match || polygons.length === 0) continue;
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let n = -Infinity;
    for (const polygon of polygons) {
      for (const [x, y] of polygon[0] ?? []) {
        if (x < w) w = x;
        if (x > e) e = x;
        if (y < s) s = y;
        if (y > n) n = y;
      }
    }
    const bbox: Bbox = [w, s, e, n];
    regions.push({
      path: match[1],
      name: feature.properties?.name ?? match[1],
      bbox,
      areaKm2: Math.round(bboxAreaKm2(bbox)),
      url,
      polygons,
    });
  }
  return regions;
}

export class GeofabrikIndex {
  private regions: IndexedRegion[] | null = null;
  private byPath = new Map<string, IndexedRegion>();
  private loadedAt = 0;
  private loading: Promise<void> | null = null;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(private readonly opts: GeofabrikIndexOptions) {
    this.fetchImpl = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.now = opts.now ?? Date.now;
  }

  private get cachePath(): string {
    return path.join(this.opts.cacheDir, INDEX_FILE);
  }

  /** Extracts whose boundary contains `bbox`, smallest first. */
  async findContaining(bbox: Bbox): Promise<GeofabrikRegion[]> {
    await this.ensureLoaded();
    const points = outlinePoints(bbox);
    return (this.regions ?? [])
      .filter((r) => {
        const [w, s, e, n] = r.bbox;
        if (bbox[0] < w || bbox[1] < s || bbox[2] > e || bbox[3] > n) return false;
        return points.every((p) => r.polygons.some((poly) => inPolygon(p, poly)));
      })
      .sort((a, b) => a.areaKm2 - b.areaKm2)
      .map(({ polygons: _polygons, ...region }) => region);
  }

  /** The region for an extract path, or null when the index does not list it. */
  async get(regionPath: string): Promise<GeofabrikRegion | null> {
    await this.ensureLoaded();
    const region = this.byPath.get(regionPath);
    if (!region) return null;
    const { polygons: _polygons, ...rest } = region;
    return rest;
  }

  /** True when `bbox` lies inside the boundary of extract `regionPath`. */
  async covers(regionPath: string, bbox: Bbox): Promise<boolean> {
    return (await this.findContaining(bbox)).some((r) => r.path === regionPath);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.regions && this.now() - this.loadedAt < this.opts.ttlMs) return;
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    await this.loading;
  }

  private async load(): Promise<void> {
    // Fresh disk copy first, so a restart does not re-download the index. Once
    // a copy is loaded the disk holds that same copy, so expiry means refetch.
    const cached = this.regions ? null : this.readCache();
    if (cached && this.now() - cached.mtimeMs < this.opts.ttlMs) {
      this.use(cached.raw, cached.mtimeMs);
      return;
    }
    try {
      const res = await this.fetchImpl(this.opts.url ?? GEOFABRIK_INDEX_URL, {
        headers: { "User-Agent": this.opts.userAgent },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();
      this.use(raw, this.now());
      fs.mkdirSync(this.opts.cacheDir, { recursive: true });
      const tmp = `${this.cachePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, raw);
      fs.renameSync(tmp, this.cachePath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (this.regions) {
        logger.warn(`Geofabrik index refresh failed (${message}); keeping the loaded copy`);
        this.loadedAt = this.now();
        return;
      }
      if (cached) {
        logger.warn(`Geofabrik index refresh failed (${message}); using the stale cached copy`);
        this.use(cached.raw, this.now());
        return;
      }
      throw new GeofabrikUnavailableError(message);
    }
  }

  private readCache(): { raw: string; mtimeMs: number } | null {
    try {
      const stat = fs.statSync(this.cachePath);
      return { raw: fs.readFileSync(this.cachePath, "utf8"), mtimeMs: stat.mtimeMs };
    } catch {
      return null;
    }
  }

  private use(raw: string, loadedAt: number): void {
    const regions = parseGeofabrikIndex(raw);
    this.regions = regions;
    this.byPath = new Map(regions.map((r) => [r.path, r]));
    this.loadedAt = loadedAt;
  }
}

/** The index could not be fetched and no cached copy exists. */
export class GeofabrikUnavailableError extends Error {
  constructor(cause: string) {
    super(`The Geofabrik index is unavailable: ${cause}`);
    this.name = "GeofabrikUnavailableError";
  }
}
