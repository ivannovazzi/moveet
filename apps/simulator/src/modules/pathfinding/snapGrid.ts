/**
 * Bounded nearest-point lookup for graph build (fleetsim-all-mlgo).
 *
 * Control points (signals, stops, crossings, ...) that do not share a vertex
 * with a kept way used to fall back to a linear scan over EVERY graph node to
 * find the nearest one, which was then discarded unless it lay within
 * `MAX_CONTROL_SNAP_KM`. On large extracts that is O(points x nodes): Rome
 * (315k nodes) spent minutes there, on the main thread and again in every
 * pathfinding worker. Only nodes inside the snap radius can ever be returned,
 * so a uniform lat/lon grid sized to that radius answers the same question by
 * looking at a handful of cells.
 *
 * The result is IDENTICAL to the linear scan: the nearest point by the caller's
 * distance function among those within `radiusKm`, ties broken by insertion
 * order (the scan's strict `<` keeps the first minimum it meets). The candidate
 * window is derived from the haversine geometry with a safety margin, so no
 * point within the radius is ever left out.
 *
 * Self-contained (no config, no logger) because the pathfinding worker bundle
 * imports it too.
 */

/** Mean Earth radius (km), as used by every haversine in the simulator. */
const EARTH_RADIUS_KM = 6371;
const DEG = Math.PI / 180;
/** Widens every candidate window so rounding can never drop a boundary point. */
const WINDOW_MARGIN = 1.05;

export class SnapGrid<T> {
  private readonly cells = new Map<number, number[]>();
  private readonly items: T[] = [];
  private readonly cellDeg: number;
  /** Latitude window (degrees) that contains every point within the radius. */
  private readonly latWindow: number;

  /**
   * @param items    points to index, in the order a linear scan would visit them
   * @param latLon   returns an item's `[lat, lon]` in degrees
   * @param radiusKm the largest distance a query may accept
   */
  constructor(
    items: Iterable<T>,
    latLon: (item: T) => readonly [number, number],
    private readonly radiusKm: number
  ) {
    for (const item of items) this.items.push(item);
    // d >= R * |dLat| for haversine, so |dLat| <= radius / R.
    this.latWindow = (radiusKm / EARTH_RADIUS_KM / DEG) * WINDOW_MARGIN;
    this.cellDeg = Math.max(this.latWindow, 1e-6);
    for (let i = 0; i < this.items.length; i++) {
      const [lat, lon] = latLon(this.items[i]);
      const key = this.key(this.cell(lat), this.cell(lon));
      let bucket = this.cells.get(key);
      if (!bucket) {
        bucket = [];
        this.cells.set(key, bucket);
      }
      bucket.push(i);
    }
  }

  private cell(deg: number): number {
    return Math.floor(deg / this.cellDeg);
  }

  /** Packs two cell coordinates into one number key (exact for |cell| < 2^25). */
  private key(cy: number, cx: number): number {
    return (cy + 0x2000000) * 0x4000000 + (cx + 0x2000000);
  }

  /**
   * The item nearest to `[lat, lon]` by `distance`, provided that distance is
   * `<= radiusKm`; otherwise null. Ties go to the earliest-inserted item.
   */
  nearestWithin(lat: number, lon: number, distance: (item: T) => number): T | null {
    if (this.items.length === 0) return null;
    // haversine: sin^2(d/2R) >= cos(lat1) cos(lat2) sin^2(dLon/2), and within
    // the radius |lat2| <= |lat1| + latWindow, so dLon is bounded below.
    const maxAbsLat = Math.abs(lat) + this.latWindow;
    const cosLat = maxAbsLat >= 90 ? 0 : Math.cos(maxAbsLat * DEG);
    const s = Math.sin(this.radiusKm / EARTH_RADIUS_KM / 2) / cosLat;
    if (!(s < 1) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return this.scan(distance);
    }
    const lonWindow = ((2 * Math.asin(s)) / DEG) * WINDOW_MARGIN;
    if (lon - lonWindow < -180 || lon + lonWindow > 180) return this.scan(distance);

    let best = -1;
    let bestDist = Infinity;
    const cy0 = this.cell(lat - this.latWindow);
    const cy1 = this.cell(lat + this.latWindow);
    const cx0 = this.cell(lon - lonWindow);
    const cx1 = this.cell(lon + lonWindow);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const bucket = this.cells.get(this.key(cy, cx));
        if (!bucket) continue;
        for (const i of bucket) {
          const d = distance(this.items[i]);
          if (d < bestDist || (d === bestDist && i < best)) {
            bestDist = d;
            best = i;
          }
        }
      }
    }
    return best >= 0 && bestDist <= this.radiusKm ? this.items[best] : null;
  }

  /** Linear fallback for degenerate windows (poles, antimeridian, NaN). */
  private scan(distance: (item: T) => number): T | null {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.items.length; i++) {
      const d = distance(this.items[i]);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best >= 0 && bestDist <= this.radiusKm ? this.items[best] : null;
  }
}
