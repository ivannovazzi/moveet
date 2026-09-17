/**
 * Compact store of learned per-edge speeds by time bucket (fleetsim-all-1ajn.4).
 *
 * Keyed by the dense edge index the route search uses (`RoadNetwork.edgeIndexOf`
 * on the main thread, `WorkerEdge.index` in the pathfinding worker — both are
 * node-insertion order over the same GeoJSON), so a learned speed can be
 * applied to the search's typed cost arrays without any string lookups.
 *
 * Storage is SPARSE per edge: a dense `edges × buckets` table would be ~660 MB
 * for the 656k-edge Nairobi extract at 168 buckets, while observations only ever
 * cover the edges vehicles actually drive. `rowOf[edge]` points into a growable
 * pool of rows, each holding one EWMA speed (Float32, km/h) and one sample count
 * (Uint16, saturating) per bucket — 6 bytes × buckets per observed edge.
 *
 * The EWMA uses `max(alpha, 1/n)` as its weight, so the first `1/alpha` samples
 * form a plain cumulative mean (no bias toward the first observation) before it
 * settles into an exponential average that tracks change.
 */

import {
  bucketCount,
  bucketMapping,
  parseBucketLayout,
  sameLayout,
  type BucketLayout,
  type BucketPeriod,
} from "./buckets";

export const SPEED_PROFILE_FILE_FORMAT = "moveet-speed-profiles";
export const SPEED_PROFILE_FILE_VERSION = 1;

const MAX_COUNT = 0xffff;
const INITIAL_ROWS = 64;

/** One exported edge: stable id, optional OSM way id, sparse `[bucket, speedKmh, count]` entries. */
export interface SpeedProfileFileEdge {
  /** Edge id: the directed node pair (`"lat,lon-lat,lon"`), stable across rebuilds of the same data. */
  id: string;
  /** OSM way id (`Edge.streetId`), informational — matching is by `id`. */
  way?: string;
  b: Array<[number, number, number]>;
}

/** The JSON profile file written by export and read by import/seed. */
export interface SpeedProfileFile {
  format: typeof SPEED_PROFILE_FILE_FORMAT;
  version: number;
  period: BucketPeriod;
  bucketHours: number;
  exportedAt?: string;
  edges: SpeedProfileFileEdge[];
}

export interface ImportResult {
  matchedEdges: number;
  unmatchedEdges: number;
  entries: number;
}

/** Sparse per-bucket override table: learned speeds (km/h) for the listed edge indices. */
export interface SpeedOverrideTable {
  indices: Int32Array;
  speeds: Float32Array;
}

export class SpeedProfileStore {
  readonly buckets: number;
  private rowOf: Int32Array;
  private rowEdge: Int32Array;
  private speeds: Float32Array;
  private counts: Uint16Array;
  private rows = 0;
  private dirty = new Set<number>();
  private samples = 0;

  constructor(
    readonly edgeCount: number,
    readonly layout: BucketLayout,
    readonly alpha: number
  ) {
    this.buckets = bucketCount(layout);
    this.rowOf = new Int32Array(edgeCount).fill(-1);
    this.rowEdge = new Int32Array(INITIAL_ROWS);
    this.speeds = new Float32Array(INITIAL_ROWS * this.buckets);
    this.counts = new Uint16Array(INITIAL_ROWS * this.buckets);
  }

  /** Edges with at least one sample in any bucket. */
  get observedEdgeCount(): number {
    return this.rows;
  }

  /** Observations recorded or imported since construction / the last clear. */
  get totalSamples(): number {
    return this.samples;
  }

  /**
   * Folds one observed running speed into the edge's bucket. Returns false (and
   * records nothing) for an unknown edge/bucket or a non-positive speed.
   */
  record(edgeIndex: number, bucket: number, speedKmh: number): boolean {
    if (!this.valid(edgeIndex, bucket) || !(speedKmh > 0) || !Number.isFinite(speedKmh)) {
      return false;
    }
    const slot = this.slot(edgeIndex, bucket, true);
    const n = Math.min(MAX_COUNT, this.counts[slot] + 1);
    const weight = Math.max(this.alpha, 1 / n);
    this.speeds[slot] =
      n === 1 ? speedKmh : this.speeds[slot] + weight * (speedKmh - this.speeds[slot]);
    this.counts[slot] = n;
    this.samples++;
    this.dirty.add(edgeIndex);
    return true;
  }

  /** The learned speed and sample count for an edge/bucket, or null when never observed. */
  sample(edgeIndex: number, bucket: number): { speedKmh: number; count: number } | null {
    if (!this.valid(edgeIndex, bucket)) return null;
    const row = this.rowOf[edgeIndex];
    if (row < 0) return null;
    const slot = row * this.buckets + bucket;
    const count = this.counts[slot];
    return count > 0 ? { speedKmh: this.speeds[slot], count } : null;
  }

  /** Learned speed when the bucket has at least `minSamples` samples, else 0. */
  speedFor(edgeIndex: number, bucket: number, minSamples: number): number {
    const s = this.sample(edgeIndex, bucket);
    return s && s.count >= minSamples ? s.speedKmh : 0;
  }

  /** Every edge whose `bucket` has at least `minSamples` samples, ascending by edge index. */
  overridesFor(bucket: number, minSamples: number): SpeedOverrideTable {
    // Walk the observed rows (not every edge of the network), then sort.
    const hits: number[] = [];
    for (let r = 0; r < this.rows; r++) {
      const slot = r * this.buckets + bucket;
      if (this.counts[slot] >= minSamples && this.counts[slot] > 0) hits.push(r);
    }
    hits.sort((a, b) => this.rowEdge[a] - this.rowEdge[b]);
    const indices = new Int32Array(hits.length);
    const speeds = new Float32Array(hits.length);
    hits.forEach((r, i) => {
      indices[i] = this.rowEdge[r];
      speeds[i] = this.speeds[r * this.buckets + bucket];
    });
    return { indices, speeds };
  }

  /** Edge indices changed since the previous call (for incremental persistence). */
  takeDirty(): number[] {
    const out = [...this.dirty];
    this.dirty.clear();
    return out;
  }

  /** Copies of an edge's dense per-bucket speeds and counts, or null when unobserved. */
  row(edgeIndex: number): { speeds: Float32Array; counts: Uint16Array } | null {
    if (edgeIndex < 0 || edgeIndex >= this.edgeCount) return null;
    const row = this.rowOf[edgeIndex];
    if (row < 0) return null;
    const from = row * this.buckets;
    return {
      speeds: this.speeds.slice(from, from + this.buckets),
      counts: this.counts.slice(from, from + this.buckets),
    };
  }

  /** Visits every observed edge index. */
  forEachObserved(fn: (edgeIndex: number) => void): void {
    for (let r = 0; r < this.rows; r++) fn(this.rowEdge[r]);
  }

  /**
   * Merges `[bucket, speedKmh, count]` entries recorded under `from` into an
   * edge, re-bucketing when the layouts differ. Merging is sample-count
   * weighted. Returns the number of entries applied.
   */
  importEntries(
    edgeIndex: number,
    from: BucketLayout,
    entries: ReadonlyArray<readonly [number, number, number]>
  ): number {
    if (edgeIndex < 0 || edgeIndex >= this.edgeCount) return 0;
    const mapping = sameLayout(from, this.layout) ? null : bucketMapping(from, this.layout);
    const sourceBuckets = bucketCount(from);
    let applied = 0;
    for (const [bucket, speedKmh, count] of entries) {
      if (!Number.isInteger(bucket) || bucket < 0 || bucket >= sourceBuckets) continue;
      if (!(speedKmh > 0) || !Number.isFinite(speedKmh) || !(count >= 1)) continue;
      const n = Math.min(MAX_COUNT, Math.floor(count));
      for (const target of mapping ? mapping[bucket] : [bucket]) {
        this.merge(edgeIndex, target, speedKmh, n);
      }
      applied++;
    }
    return applied;
  }

  /** {@link importEntries} for a dense persisted row. */
  importRow(
    edgeIndex: number,
    from: BucketLayout,
    speeds: ArrayLike<number>,
    counts: ArrayLike<number>
  ): number {
    const entries: Array<[number, number, number]> = [];
    for (let b = 0; b < counts.length; b++) {
      if (counts[b] > 0) entries.push([b, speeds[b], counts[b]]);
    }
    return this.importEntries(edgeIndex, from, entries);
  }

  /** Serializes every observed edge into the portable JSON profile file. */
  toFile(keyOf: (edgeIndex: number) => { id: string; way?: string }): SpeedProfileFile {
    const edges: SpeedProfileFileEdge[] = [];
    for (let r = 0; r < this.rows; r++) {
      const edge = this.rowEdge[r];
      const b: Array<[number, number, number]> = [];
      for (let bucket = 0; bucket < this.buckets; bucket++) {
        const slot = r * this.buckets + bucket;
        if (this.counts[slot] > 0) {
          // Rounded to 0.01 km/h: float32 noise is not worth shipping.
          b.push([bucket, Math.round(this.speeds[slot] * 100) / 100, this.counts[slot]]);
        }
      }
      const key = keyOf(edge);
      edges.push(key.way ? { id: key.id, way: key.way, b } : { id: key.id, b });
    }
    return {
      format: SPEED_PROFILE_FILE_FORMAT,
      version: SPEED_PROFILE_FILE_VERSION,
      period: this.layout.period,
      bucketHours: this.layout.bucketHours,
      exportedAt: new Date().toISOString(),
      edges,
    };
  }

  /**
   * Merges a profile file into the store. Edges are matched by id; ids the
   * current network does not have (a regenerated or different extract) are
   * counted and skipped, so a file from an older network still seeds every edge
   * that survived.
   */
  importFile(file: SpeedProfileFile, indexOf: (edgeId: string) => number): ImportResult {
    if (file.format !== SPEED_PROFILE_FILE_FORMAT) {
      throw new Error(`not a speed profile file (format ${String(file.format)})`);
    }
    if (file.version !== SPEED_PROFILE_FILE_VERSION) {
      throw new Error(`unsupported speed profile file version ${file.version}`);
    }
    const from = parseBucketLayout(file.period, file.bucketHours);
    const result: ImportResult = { matchedEdges: 0, unmatchedEdges: 0, entries: 0 };
    for (const edge of file.edges) {
      const index = indexOf(edge.id);
      if (index < 0 || index >= this.edgeCount) {
        result.unmatchedEdges++;
        continue;
      }
      result.matchedEdges++;
      result.entries += this.importEntries(index, from, edge.b);
    }
    return result;
  }

  clear(): void {
    this.rowOf.fill(-1);
    this.speeds.fill(0);
    this.counts.fill(0);
    this.rows = 0;
    this.samples = 0;
    this.dirty.clear();
  }

  private merge(edgeIndex: number, bucket: number, speedKmh: number, n: number): void {
    const slot = this.slot(edgeIndex, bucket, true);
    const c = this.counts[slot];
    this.speeds[slot] = (this.speeds[slot] * c + speedKmh * n) / (c + n);
    this.counts[slot] = Math.min(MAX_COUNT, c + n);
    this.samples += n;
    this.dirty.add(edgeIndex);
  }

  private valid(edgeIndex: number, bucket: number): boolean {
    return (
      Number.isInteger(edgeIndex) &&
      edgeIndex >= 0 &&
      edgeIndex < this.edgeCount &&
      Number.isInteger(bucket) &&
      bucket >= 0 &&
      bucket < this.buckets
    );
  }

  /** Slot of (edge, bucket), allocating the edge's row when `create` is set. */
  private slot(edgeIndex: number, bucket: number, create: boolean): number {
    let row = this.rowOf[edgeIndex];
    if (row < 0 && create) {
      if (this.rows === this.rowEdge.length) this.grow();
      row = this.rows++;
      this.rowOf[edgeIndex] = row;
      this.rowEdge[row] = edgeIndex;
    }
    return row * this.buckets + bucket;
  }

  private grow(): void {
    const capacity = this.rowEdge.length * 2;
    const rowEdge = new Int32Array(capacity);
    rowEdge.set(this.rowEdge);
    const speeds = new Float32Array(capacity * this.buckets);
    speeds.set(this.speeds);
    const counts = new Uint16Array(capacity * this.buckets);
    counts.set(this.counts);
    this.rowEdge = rowEdge;
    this.speeds = speeds;
    this.counts = counts;
  }
}
