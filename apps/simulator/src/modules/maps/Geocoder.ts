import type { GeocodeResult } from "@moveet/shared-types";
import type { FetchLike } from "./GeofabrikIndex";
import { simplifyPolygons } from "./simplify";

/**
 * Server-side place search against Nominatim, for picking a map area by name.
 *
 * Follows the public instance's usage policy
 * (https://operations.osmfoundation.org/policies/nominatim/): a User-Agent that
 * identifies the application, at most one request per second, and cached
 * results. Requests beyond the rate are queued; when the queue is full the
 * caller gets {@link GeocodeRateLimitError} (HTTP 429) instead of waiting.
 */

export const NOMINATIM_ATTRIBUTION =
  "Search by Nominatim. Data © OpenStreetMap contributors, ODbL 1.0.";

export class GeocodeRateLimitError extends Error {
  constructor() {
    super("Too many place searches; try again in a moment");
    this.name = "GeocodeRateLimitError";
  }
}

export class GeocodeUpstreamError extends Error {
  constructor(message: string) {
    super(`Place search failed: ${message}`);
    this.name = "GeocodeUpstreamError";
  }
}

export interface GeocoderOptions {
  baseUrl: string;
  userAgent: string;
  fetch?: FetchLike;
  /** Minimum ms between upstream requests (default 1000). */
  minIntervalMs?: number;
  /** Searches allowed to wait for their turn (default 5). */
  maxQueue?: number;
  cacheSize?: number;
  cacheTtlMs?: number;
  limit?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface NominatimPlace {
  display_name?: string;
  boundingbox?: [string, string, string, string];
  lat?: string;
  lon?: string;
  class?: string;
  type?: string;
  category?: string;
  geojson?: { type?: string; coordinates?: unknown };
}

/** Upstream simplification Nominatim applies before sending a boundary (degrees). */
const NOMINATIM_POLYGON_THRESHOLD = "0.0005";

/**
 * The place's boundary, simplified for a map preview: the tolerance scales
 * with the place's size, so a district keeps its shape and a country stays
 * small on the wire. Undefined for places without an area (points, roads).
 */
export function placeOutline(
  geojson: NominatimPlace["geojson"],
  bbox: [number, number, number, number]
): [number, number][][][] | undefined {
  if (!geojson) return undefined;
  let polygons: [number, number][][][];
  if (geojson.type === "Polygon") polygons = [geojson.coordinates as [number, number][][]];
  else if (geojson.type === "MultiPolygon") {
    polygons = geojson.coordinates as [number, number][][][];
  } else return undefined;
  const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
  const outline = simplifyPolygons(polygons, Math.max(0.0005, span / 400));
  return outline.length > 0 ? outline : undefined;
}

/** Nominatim's `boundingbox` is `[south, north, west, east]` as strings. */
export function toGeocodeResult(place: NominatimPlace): GeocodeResult | null {
  const bb = place.boundingbox?.map(Number);
  const lat = Number(place.lat);
  const lon = Number(place.lon);
  if (bb?.length !== 4 || !bb.every(Number.isFinite)) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const [s, n, w, e] = bb;
  const bbox: [number, number, number, number] = [w, s, e, n];
  const outline = placeOutline(place.geojson, bbox);
  return {
    name: place.display_name ?? `${lat}, ${lon}`,
    bbox,
    center: [lon, lat],
    type: `${place.class ?? place.category ?? "place"}/${place.type ?? "unknown"}`,
    ...(outline ? { outline } : {}),
  };
}

export class Geocoder {
  private readonly cache = new Map<string, { at: number; results: GeocodeResult[] }>();
  private readonly inflight = new Map<string, Promise<GeocodeResult[]>>();
  private chain: Promise<void> = Promise.resolve();
  private waiting = 0;
  private lastRequestAt = -Infinity;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: GeocoderOptions) {
    this.fetchImpl = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async search(query: string): Promise<GeocodeResult[]> {
    const key = query.trim().toLowerCase().replace(/\s+/g, " ");
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < (this.opts.cacheTtlMs ?? 24 * 3600_000)) {
      // Refresh recency for the LRU.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit.results;
    }
    const pending = this.inflight.get(key);
    if (pending) return pending;

    if (this.waiting >= (this.opts.maxQueue ?? 5)) throw new GeocodeRateLimitError();
    this.waiting++;
    const run = this.chain.then(async () => {
      this.waiting--;
      const wait = this.lastRequestAt + (this.opts.minIntervalMs ?? 1000) - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = this.now();
      return this.fetchResults(query.trim());
    });
    // The next search waits for this one's turn, whatever its outcome.
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    const promise = run
      .then((results) => {
        this.remember(key, results);
        return results;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private async fetchResults(query: string): Promise<GeocodeResult[]> {
    const url = new URL("/search", this.opts.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", String(this.opts.limit ?? 8));
    // The place's own boundary, for the area picker's live preview.
    url.searchParams.set("polygon_geojson", "1");
    url.searchParams.set("polygon_threshold", NOMINATIM_POLYGON_THRESHOLD);
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(url.toString(), {
        headers: { "User-Agent": this.opts.userAgent, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new GeocodeUpstreamError(err instanceof Error ? err.message : String(err));
    }
    if (res.status === 429) throw new GeocodeRateLimitError();
    if (!res.ok) throw new GeocodeUpstreamError(`HTTP ${res.status}`);
    let places: unknown;
    try {
      places = JSON.parse(await res.text());
    } catch {
      throw new GeocodeUpstreamError("unreadable response");
    }
    if (!Array.isArray(places)) throw new GeocodeUpstreamError("unexpected response");
    return places
      .map((p) => toGeocodeResult(p as NominatimPlace))
      .filter((r): r is GeocodeResult => r !== null);
  }

  private remember(key: string, results: GeocodeResult[]): void {
    this.cache.set(key, { at: this.now(), results });
    const max = this.opts.cacheSize ?? 200;
    while (this.cache.size > max) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
  }
}
