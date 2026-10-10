import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import type {
  GeofabrikLookupResponse,
  GeofabrikOutline,
  GeofabrikRegion,
} from "@moveet/shared-types";
import logger from "../../utils/logger";
import { type Bbox, bboxAreaKm2 } from "./bbox";
import { simplifyPolygons } from "./simplify";

/**
 * Geofabrik's official extract index (https://download.geofabrik.de/technical.html):
 * every downloadable region with its boundary polygon, its parent in the
 * extract hierarchy and its `.pbf` URL.
 *
 * It answers these questions for map builds:
 *  - which extract(s) cover a bbox, smallest first (`GET /maps/geofabrik`),
 *    and which borders the box crosses when no small one does;
 *  - the smallest extract to cut a box from, a parent in the hierarchy when
 *    the box crosses a border (`POST /maps` without a `geofabrik`);
 *  - whether a requested extract path is real: the index is the allowlist for
 *    `POST /maps`, so the simulator only ever downloads URLs it built from a
 *    path found here, never one a client supplied;
 *  - what the extracts look like, simplified, for the area picker
 *    (`GET /maps/geofabrik/regions`).
 *
 * The index (a few MB) is cached on disk and refreshed after a TTL; when a
 * refresh fails, the stale copy keeps serving. The simplified outlines are
 * derived from it and cached next to it, tagged with a hash of the index they
 * came from, so they are rebuilt exactly when the index content changes.
 */

export const GEOFABRIK_INDEX_URL = "https://download.geofabrik.de/index-v1.json";
export const GEOFABRIK_OUTLINES_ATTRIBUTION =
  "Extract boundaries: Geofabrik GmbH (download.geofabrik.de), from OpenStreetMap contributors data, ODbL 1.0";
const PBF_URL = /^https:\/\/download\.geofabrik\.de\/(.+)-latest\.osm\.pbf$/;
const INDEX_FILE = "geofabrik-index.json";
const OUTLINES_FILE = "geofabrik-outlines.json";

/** Outline simplification by hierarchy depth, in degrees: continents coarse, regions fine. */
export const OUTLINE_TOLERANCE = [0.2, 0.04, 0.012] as const;

/** Extracts whose download size a lookup asks Geofabrik for (the likely picks). */
const SIZED_REGIONS = 3;
/** How long a lookup waits for those sizes before answering without them. */
const SIZE_WAIT_MS = 1500;
/** A size request that failed is tried again after this long. */
const SIZE_RETRY_MS = 10 * 60_000;

type Ring = [number, number][];
type Polygon = Ring[];

interface IndexFeature {
  properties?: { id?: string; parent?: string; name?: string; urls?: { pbf?: string } };
  geometry?: { type?: string; coordinates?: unknown } | null;
}

interface IndexedRegion extends GeofabrikRegion {
  polygons: Polygon[];
  depth: number;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  headers?: { get(name: string): string | null };
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<FetchResponse>;

export interface GeofabrikIndexOptions {
  cacheDir: string;
  ttlMs: number;
  userAgent: string;
  fetch?: FetchLike;
  url?: string;
  now?: () => number;
  /** How long a lookup waits for download sizes (default 1500 ms). */
  sizeWaitMs?: number;
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

function regionHas(region: IndexedRegion, point: [number, number]): boolean {
  const [w, s, e, n] = region.bbox;
  if (point[0] < w || point[0] > e || point[1] < s || point[1] > n) return false;
  return region.polygons.some((poly) => inPolygon(point, poly));
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

/** The public shape of a region: no boundary, no internals. */
function publicRegion({ polygons: _p, depth: _d, ...region }: IndexedRegion): GeofabrikRegion {
  return region;
}

/** Parses Geofabrik's `index-v1.json` into regions with a path, parent, bbox and area. */
export function parseGeofabrikIndex(raw: string): IndexedRegion[] {
  const data = JSON.parse(raw) as { features?: IndexFeature[] };
  if (!Array.isArray(data.features)) throw new Error("Geofabrik index has no features");
  const regions: IndexedRegion[] = [];
  const parentIdOf = new Map<IndexedRegion, string>();
  const pathById = new Map<string, string>();
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
    const region: IndexedRegion = {
      path: match[1],
      name: feature.properties?.name ?? match[1],
      bbox,
      areaKm2: Math.round(bboxAreaKm2(bbox)),
      url,
      polygons,
      depth: 0,
    };
    regions.push(region);
    if (feature.properties?.id) pathById.set(feature.properties.id, region.path);
    if (feature.properties?.parent) parentIdOf.set(region, feature.properties.parent);
  }
  // Parents are referenced by id; resolve them to extract paths.
  for (const [region, parentId] of parentIdOf) {
    const parent = pathById.get(parentId);
    if (parent && parent !== region.path) region.parent = parent;
  }
  const byPath = new Map(regions.map((r) => [r.path, r]));
  for (const region of regions) {
    let depth = 0;
    let at = region.parent ? byPath.get(region.parent) : undefined;
    // Bounded, so a malformed index with a parent loop cannot hang the server.
    while (at && depth < 16) {
      depth++;
      at = at.parent ? byPath.get(at.parent) : undefined;
    }
    region.depth = depth;
  }
  return regions;
}

export class GeofabrikIndex {
  private regions: IndexedRegion[] | null = null;
  private byPath = new Map<string, IndexedRegion>();
  private loadedAt = 0;
  /** Content hash of the loaded index: what the derived outlines are tagged with. */
  private version = "";
  private loading: Promise<void> | null = null;
  private outlinesMemo: { version: string; outlines: GeofabrikOutline[] } | null = null;
  private readonly sizes = new Map<string, { bytes: number | null; at: number }>();
  private readonly sizing = new Map<string, Promise<number | null>>();
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(private readonly opts: GeofabrikIndexOptions) {
    this.fetchImpl = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.now = opts.now ?? Date.now;
  }

  private get cachePath(): string {
    return path.join(this.opts.cacheDir, INDEX_FILE);
  }

  private get outlinesPath(): string {
    return path.join(this.opts.cacheDir, OUTLINES_FILE);
  }

  /** Extracts whose boundary contains `bbox`, smallest first. */
  async findContaining(bbox: Bbox): Promise<GeofabrikRegion[]> {
    await this.ensureLoaded();
    return this.containing(bbox).map(publicRegion);
  }

  /**
   * The lookup behind `GET /maps/geofabrik`: the containing extracts (the
   * first few with their download size), and, when the box crosses a border
   * between extracts, the smallest extract under each part of it.
   */
  async lookup(bbox: Bbox): Promise<GeofabrikLookupResponse> {
    await this.ensureLoaded();
    const regions = this.containing(bbox).map(publicRegion);
    // Sizes are a nicety: wait for them only briefly. A slow answer still
    // lands in the cache, so the next lookup (the box nudged, or a retry) has it.
    const sized = Promise.all(
      regions.slice(0, SIZED_REGIONS).map(async (r) => {
        const bytes = await this.sizeOf(r);
        if (bytes !== null) r.sizeBytes = bytes;
      })
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      sized,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.opts.sizeWaitMs ?? SIZE_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
    const crosses = this.crossings(bbox);
    return crosses.length > 1 ? { regions, crosses } : { regions };
  }

  /**
   * The smallest extract to cut `bbox` from, or null when none holds it all.
   *
   * Searched over the whole index rather than by walking up from the extract
   * under the box's centre: that walk always ends at a parent that contains
   * the box when one exists, but Geofabrik's trees overlap at the edges (a box
   * over Monaco and Menton fits Provence-Alpes-Cote-d'Azur, while Monaco's own
   * parent is Europe), and the global search finds the cheaper download.
   */
  async smallestContaining(bbox: Bbox): Promise<GeofabrikRegion | null> {
    await this.ensureLoaded();
    const best = this.containing(bbox)[0];
    return best ? publicRegion(best) : null;
  }

  /** The region for an extract path, or null when the index does not list it. */
  async get(regionPath: string): Promise<GeofabrikRegion | null> {
    await this.ensureLoaded();
    const region = this.byPath.get(regionPath);
    return region ? publicRegion(region) : null;
  }

  /** True when `bbox` lies inside the boundary of extract `regionPath`. */
  async covers(regionPath: string, bbox: Bbox): Promise<boolean> {
    await this.ensureLoaded();
    const region = this.byPath.get(regionPath);
    return region ? outlinePoints(bbox).every((p) => regionHas(region, p)) : false;
  }

  /**
   * Every extract's boundary, simplified for a world map (the tolerance grows
   * towards the top of the hierarchy) and rounded to 3 decimals.
   */
  async outlines(): Promise<GeofabrikOutline[]> {
    await this.ensureLoaded();
    if (this.outlinesMemo?.version === this.version) return this.outlinesMemo.outlines;
    const outlines = this.readOutlines() ?? this.buildOutlines();
    this.outlinesMemo = { version: this.version, outlines };
    return outlines;
  }

  // ─── Internals ────────────────────────────────────────────────────

  private containing(bbox: Bbox): IndexedRegion[] {
    const points = outlinePoints(bbox);
    return (this.regions ?? [])
      .filter((r) => {
        const [w, s, e, n] = r.bbox;
        if (bbox[0] < w || bbox[1] < s || bbox[2] > e || bbox[3] > n) return false;
        return points.every((p) => regionHas(r, p));
      })
      .sort((a, b) => a.areaKm2 - b.areaKm2);
  }

  /** The smallest extract containing `point`, if any. */
  private smallestAt(point: [number, number]): IndexedRegion | undefined {
    let best: IndexedRegion | undefined;
    for (const r of this.regions ?? []) {
      if ((!best || r.areaKm2 < best.areaKm2) && regionHas(r, point)) best = r;
    }
    return best;
  }

  /** The distinct smallest extracts under the box's sample points, smallest first. */
  private crossings(bbox: Bbox): { path: string; name: string }[] {
    const seen = new Map<string, IndexedRegion>();
    for (const p of outlinePoints(bbox)) {
      const r = this.smallestAt(p);
      if (r) seen.set(r.path, r);
    }
    return [...seen.values()]
      .sort((a, b) => a.areaKm2 - b.areaKm2)
      .map((r) => ({ path: r.path, name: r.name }));
  }

  /**
   * The `.pbf` size from a HEAD request; null when unknown. A size is kept
   * for the index TTL and a failure for {@link SIZE_RETRY_MS}; concurrent
   * lookups share one request.
   */
  private sizeOf(region: GeofabrikRegion): Promise<number | null> {
    const cached = this.sizes.get(region.path);
    if (cached) {
      const ttl = cached.bytes === null ? SIZE_RETRY_MS : this.opts.ttlMs;
      if (this.now() - cached.at < ttl) return Promise.resolve(cached.bytes);
    }
    const pending = this.sizing.get(region.path);
    if (pending) return pending;
    const request = (async () => {
      let bytes: number | null = null;
      try {
        const res = await this.fetchImpl(region.url, {
          method: "HEAD",
          headers: { "User-Agent": this.opts.userAgent },
          signal: AbortSignal.timeout(15_000),
        });
        const length = res.ok ? Number(res.headers?.get("content-length")) : Number.NaN;
        bytes = Number.isFinite(length) && length > 0 ? length : null;
      } catch {
        bytes = null;
      }
      this.sizes.set(region.path, { bytes, at: this.now() });
      this.sizing.delete(region.path);
      return bytes;
    })();
    this.sizing.set(region.path, request);
    return request;
  }

  private buildOutlines(): GeofabrikOutline[] {
    const started = this.now();
    const outlines: GeofabrikOutline[] = [];
    for (const r of this.regions ?? []) {
      const tolerance = OUTLINE_TOLERANCE[Math.min(r.depth, OUTLINE_TOLERANCE.length - 1)];
      const polygons = simplifyPolygons(r.polygons, tolerance);
      if (polygons.length === 0) continue;
      outlines.push({
        path: r.path,
        name: r.name,
        ...(r.parent ? { parent: r.parent } : {}),
        depth: r.depth,
        polygons,
      });
    }
    try {
      fs.mkdirSync(this.opts.cacheDir, { recursive: true });
      const tmp = `${this.outlinesPath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ index: this.version, outlines }));
      fs.renameSync(tmp, this.outlinesPath);
    } catch (err) {
      logger.warn(`Could not cache the Geofabrik outlines: ${err}`);
    }
    logger.debug(`Simplified ${outlines.length} Geofabrik outlines in ${this.now() - started} ms`);
    return outlines;
  }

  /** The outlines cached on disk, when they were built from the index now loaded. */
  private readOutlines(): GeofabrikOutline[] | null {
    try {
      const data = JSON.parse(fs.readFileSync(this.outlinesPath, "utf8")) as {
        index?: string;
        outlines?: GeofabrikOutline[];
      };
      if (data.index !== this.version || !Array.isArray(data.outlines)) return null;
      return data.outlines;
    } catch {
      return null;
    }
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
    this.version = createHash("sha1").update(raw).digest("hex");
  }
}

/** The index could not be fetched and no cached copy exists. */
export class GeofabrikUnavailableError extends Error {
  constructor(cause: string) {
    super(`The Geofabrik index is unavailable: ${cause}`);
    this.name = "GeofabrikUnavailableError";
  }
}
