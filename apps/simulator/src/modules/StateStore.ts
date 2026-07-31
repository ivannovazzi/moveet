import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import logger from "../utils/logger";
import type { AnalyticsSummary, FleetAnalytics, RecordingMetadata } from "../types";
import {
  ANALYTICS_BUCKET_AGGREGATION,
  type AnalyticsBucketInfo,
  type AnalyticsBucketMeta,
  type AnalyticsHistoryMeta,
  type AnalyticsHistoryRow,
  type AnalyticsOrder,
} from "@moveet/shared-types";

// Re-exported so the routes and tests that already read the analytics contract
// from this module keep one import site; the declarations themselves are the
// shared ones.
export {
  ANALYTICS_BUCKET_AGGREGATION,
  type AnalyticsBucketInfo,
  type AnalyticsBucketMeta,
  type AnalyticsHistoryMeta,
  type AnalyticsHistoryRow,
  type AnalyticsOrder,
};

/**
 * Shape of a simulation state snapshot.
 * All fields are JSON-serialized strings stored in SQLite.
 */
export interface SnapshotData {
  vehicles: string;
  fleets: string;
  geofences: string;
  incidents: string;
  analytics: string;
}

export interface SnapshotMeta {
  id: number;
  created_at: string;
}

export interface SnapshotRow extends SnapshotMeta, SnapshotData {}

// ─── Analytics history query shaping ────────────────────────────────
//
// The row, bucket and metadata shapes are the wire contract with the UI, so
// they live in `@moveet/shared-types` (see its `rest.ts`) rather than here.
// Only the store-internal pieces below — how a query is asked for, and how the
// result carries its metadata in-process — are simulator-local.

/**
 * Analytics rows plus their metadata.
 *
 * It is an `Array` so `res.json()` and every existing caller keep seeing the
 * exact same JSON payload; `meta` is a non-enumerable property, invisible to
 * `JSON.stringify`, spreads and deep-equality checks, that transports the
 * truncation/bucketing facts to the HTTP layer.
 */
export type AnalyticsHistoryResult = AnalyticsHistoryRow[] & {
  readonly meta: AnalyticsHistoryMeta;
};

/** Options for shaping an analytics history query. */
export interface AnalyticsHistoryOptions {
  /** Row order in the payload. Default `"asc"`. Truncation always keeps the newest. */
  order?: AnalyticsOrder;
  /** Downsample width: `"auto"`, a duration (`"30s"`, `"5m"`, `"1h"`) or milliseconds. */
  bucket?: string | number | null;
}

/** Row shape returned by SELECT on the recordings table. */
export interface RecordingRow {
  id: number;
  file_path: string;
  duration: number;
  event_count: number;
  file_size: number;
  vehicle_count: number;
  start_time: string;
  created_at: string;
}

// ─── Analytics history helpers ──────────────────────────────────────

/** Upper bound on rows (or buckets) a single history query may return. */
const MAX_ANALYTICS_LIMIT = 10000;

/**
 * Hard cap on stored rows read while bucketing. At the 5 s persistence cadence
 * this is ~14 days of samples; beyond it the query reports truncation instead
 * of scanning the table forever.
 */
const MAX_BUCKET_SCAN_ROWS = 250_000;

/** Sentinels used when only one side of the range is supplied. */
const MIN_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const MAX_TIMESTAMP = "9999-12-31T23:59:59.999Z";

const MIN_BUCKET_MS = 1000;
const MAX_BUCKET_MS = 7 * 24 * 60 * 60 * 1000;

const BUCKET_UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Widths `bucket=auto` may pick from, ascending. */
const AUTO_BUCKET_LADDER_MS = [
  1_000, 5_000, 10_000, 30_000, 60_000, 300_000, 900_000, 1_800_000, 3_600_000, 10_800_000,
  21_600_000, 43_200_000, 86_400_000,
];

/**
 * Parses a bucket specification.
 *
 * Accepts `"auto"`, a duration string (`"30s"`, `"5m"`, `"1h"`, `"1d"`) or a
 * raw millisecond count. Returns `null` for anything unparseable or out of the
 * `[1s, 7d]` range so callers can answer 400 rather than guess.
 */
export function parseBucketSpec(spec: string | number): number | "auto" | null {
  if (typeof spec === "number") {
    return Number.isFinite(spec) && spec >= MIN_BUCKET_MS && spec <= MAX_BUCKET_MS
      ? Math.floor(spec)
      : null;
  }

  const trimmed = spec.trim().toLowerCase();
  if (trimmed === "auto") return "auto";

  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(trimmed);
  if (match) {
    const ms = Math.floor(Number(match[1]) * BUCKET_UNIT_MS[match[2]]);
    return ms >= MIN_BUCKET_MS && ms <= MAX_BUCKET_MS ? ms : null;
  }

  if (/^\d+$/.test(trimmed)) return parseBucketSpec(Number(trimmed));

  return null;
}

/** Renders a bucket width back into its most compact canonical label. */
export function formatBucketLabel(durationMs: number): string {
  for (const [unit, size] of [
    ["d", BUCKET_UNIT_MS.d],
    ["h", BUCKET_UNIT_MS.h],
    ["m", BUCKET_UNIT_MS.m],
    ["s", BUCKET_UNIT_MS.s],
  ] as const) {
    if (durationMs % size === 0) return `${durationMs / size}${unit}`;
  }
  return `${durationMs}ms`;
}

/** Smallest ladder width that fits `spanMs` into at most `targetBuckets`. */
function pickAutoBucket(spanMs: number, targetBuckets: number): number {
  const ideal = spanMs / Math.max(1, targetBuckets);
  for (const candidate of AUTO_BUCKET_LADDER_MS) {
    if (candidate >= ideal) return candidate;
  }
  return AUTO_BUCKET_LADDER_MS[AUTO_BUCKET_LADDER_MS.length - 1];
}

/** Trims float noise introduced by summing then dividing. */
function roundValue(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Raw `analytics_history` row as SQLite hands it over. */
interface RawAnalyticsRow {
  id: number;
  timestamp: string;
  summary: string;
  fleets: string;
}

function decodeRow(row: RawAnalyticsRow): AnalyticsHistoryRow {
  return {
    id: row.id,
    timestamp: row.timestamp,
    summary: JSON.parse(row.summary) as AnalyticsSummary,
    fleets: JSON.parse(row.fleets) as FleetAnalytics[],
  };
}

/** Running fold of one fleet inside one bucket. */
interface FleetAccumulator {
  /** Newest sample seen for this fleet — the source of every "last" field. */
  latest: FleetAnalytics;
  samples: number;
  activeCount: number;
  avgSpeed: number;
  routeEfficiency: number;
}

/** Running fold of one time bucket. */
interface BucketAccumulator {
  /** Epoch ms of the bucket start. */
  key: number;
  /** Newest row in the bucket — the source of every "last" field. */
  latest: AnalyticsHistoryRow;
  oldestTimestamp: string;
  sampleCount: number;
  activeVehicles: number;
  avgSpeed: number;
  avgRouteEfficiency: number;
  fleets: Map<string, FleetAccumulator>;
}

/** Folds one raw row into its bucket, respecting per-field aggregation rules. */
function accumulate(acc: BucketAccumulator, row: AnalyticsHistoryRow): void {
  acc.sampleCount += 1;
  acc.oldestTimestamp = row.timestamp;
  acc.activeVehicles += row.summary.activeVehicles ?? 0;
  acc.avgSpeed += row.summary.avgSpeed ?? 0;
  acc.avgRouteEfficiency += row.summary.avgRouteEfficiency ?? 0;

  for (const fleet of row.fleets ?? []) {
    const existing = acc.fleets.get(fleet.fleetId);
    if (existing) {
      existing.samples += 1;
      existing.activeCount += fleet.activeCount ?? 0;
      existing.avgSpeed += fleet.avgSpeed ?? 0;
      existing.routeEfficiency += fleet.routeEfficiency ?? 0;
    } else {
      // Rows arrive newest-first, so the first sighting of a fleet is its
      // newest sample and therefore the "last" value for this bucket.
      acc.fleets.set(fleet.fleetId, {
        latest: fleet,
        samples: 1,
        activeCount: fleet.activeCount ?? 0,
        avgSpeed: fleet.avgSpeed ?? 0,
        routeEfficiency: fleet.routeEfficiency ?? 0,
      });
    }
  }
}

/** Materializes an accumulated bucket into an `AnalyticsHistoryRow`. */
function finalizeBucket(acc: BucketAccumulator, durationMs: number): AnalyticsHistoryRow {
  const n = acc.sampleCount;
  const last = acc.latest;

  return {
    // The newest underlying row's id, so ids stay real and strictly increasing.
    id: last.id,
    timestamp: new Date(acc.key).toISOString(),
    summary: {
      totalVehicles: last.summary.totalVehicles,
      activeVehicles: roundValue(acc.activeVehicles / n),
      totalDistanceTraveled: last.summary.totalDistanceTraveled,
      avgSpeed: roundValue(acc.avgSpeed / n),
      totalIdleTime: last.summary.totalIdleTime,
      avgRouteEfficiency: roundValue(acc.avgRouteEfficiency / n),
      timestamp: acc.key,
    },
    fleets: [...acc.fleets.values()].map((fleet) => ({
      fleetId: fleet.latest.fleetId,
      vehicleCount: fleet.latest.vehicleCount,
      activeCount: roundValue(fleet.activeCount / fleet.samples),
      totalDistance: fleet.latest.totalDistance,
      avgSpeed: roundValue(fleet.avgSpeed / fleet.samples),
      totalIdleTime: fleet.latest.totalIdleTime,
      routeEfficiency: roundValue(fleet.routeEfficiency / fleet.samples),
      vehicles: fleet.latest.vehicles,
    })),
    bucket: {
      durationMs,
      label: formatBucketLabel(durationMs),
      start: new Date(acc.key).toISOString(),
      end: new Date(acc.key + durationMs).toISOString(),
      sampleCount: n,
      firstTimestamp: acc.oldestTimestamp,
      lastTimestamp: last.timestamp,
    },
  };
}

/** Attaches `meta` to the rows array without making it part of the JSON body. */
function withMeta(rows: AnalyticsHistoryRow[], meta: AnalyticsHistoryMeta): AnalyticsHistoryResult {
  Object.defineProperty(rows, "meta", { value: meta, enumerable: false, configurable: true });
  return rows as AnalyticsHistoryResult;
}

/**
 * Low-level SQLite state store for simulation persistence.
 *
 * Manages three tables:
 * - `snapshots` — periodic simulation state snapshots
 * - `analytics_history` — time-series analytics for historical queries
 * - `recordings` — recording file metadata index
 *
 * Uses WAL mode for concurrent reads and prepared statements for performance.
 */
export class StateStore {
  private db: Database.Database;

  // ─── Snapshot statements ──────────────────────────────────────────
  private insertSnapshotStmt: Database.Statement;
  private latestSnapshotStmt: Database.Statement;
  private listSnapshotsStmt: Database.Statement;
  private deleteOldSnapshotsStmt: Database.Statement;

  // ─── Analytics history statements ─────────────────────────────────
  private insertAnalyticsStmt: Database.Statement;
  private selectAnalyticsDescStmt: Database.Statement;
  private analyticsRangeStatsStmt: Database.Statement;
  private pruneAnalyticsStmt: Database.Statement;
  private countAnalyticsStmt: Database.Statement;

  // ─── Recording statements ─────────────────────────────────────────
  private insertRecordingStmt: Database.Statement;
  private getRecordingsStmt: Database.Statement;
  private getRecordingStmt: Database.Statement;
  private getRecordingByPathStmt: Database.Statement;
  private deleteRecordingStmt: Database.Statement;

  constructor(dbPath: string = "data/state.db") {
    // Ensure directory exists (skip for in-memory DBs)
    if (dbPath !== ":memory:") {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");

    this.migrate();

    // ─── Snapshot prepared statements ─────────────────────────────
    this.insertSnapshotStmt = this.db.prepare(`
      INSERT INTO snapshots (vehicles, fleets, geofences, incidents, analytics)
      VALUES (@vehicles, @fleets, @geofences, @incidents, @analytics)
    `);

    this.latestSnapshotStmt = this.db.prepare(`
      SELECT id, created_at, vehicles, fleets, geofences, incidents, analytics
      FROM snapshots
      ORDER BY id DESC
      LIMIT 1
    `);

    this.listSnapshotsStmt = this.db.prepare(`
      SELECT id, created_at
      FROM snapshots
      ORDER BY id DESC
      LIMIT ?
    `);

    this.deleteOldSnapshotsStmt = this.db.prepare(`
      DELETE FROM snapshots
      WHERE id NOT IN (
        SELECT id FROM snapshots ORDER BY id DESC LIMIT ?
      )
    `);

    // ─── Analytics history prepared statements ────────────────────
    this.insertAnalyticsStmt = this.db.prepare(
      `INSERT INTO analytics_history (timestamp, summary, fleets) VALUES (?, ?, ?)`
    );

    // Reads run newest-first so a LIMIT keeps the RECENT end of the window;
    // ascending payloads are produced by reversing in JS.
    this.selectAnalyticsDescStmt = this.db.prepare(
      `SELECT id, timestamp, summary, fleets FROM analytics_history
       WHERE timestamp >= ? AND timestamp <= ?
       ORDER BY timestamp DESC, id DESC
       LIMIT ?`
    );

    this.analyticsRangeStatsStmt = this.db.prepare(
      `SELECT COUNT(*) AS count, MIN(timestamp) AS min_ts, MAX(timestamp) AS max_ts
       FROM analytics_history
       WHERE timestamp >= ? AND timestamp <= ?`
    );

    this.pruneAnalyticsStmt = this.db.prepare(`DELETE FROM analytics_history WHERE timestamp < ?`);

    this.countAnalyticsStmt = this.db.prepare(`SELECT COUNT(*) as count FROM analytics_history`);

    // ─── Recording prepared statements ────────────────────────────
    this.insertRecordingStmt = this.db.prepare(`
      INSERT INTO recordings (file_path, duration, event_count, file_size, vehicle_count, start_time)
      VALUES (@file_path, @duration, @event_count, @file_size, @vehicle_count, @start_time)
    `);

    this.getRecordingsStmt = this.db.prepare(`
      SELECT id, file_path, duration, event_count, file_size, vehicle_count, start_time, created_at
      FROM recordings
      ORDER BY id DESC
    `);

    this.getRecordingStmt = this.db.prepare(`
      SELECT id, file_path, duration, event_count, file_size, vehicle_count, start_time, created_at
      FROM recordings
      WHERE id = ?
    `);

    this.getRecordingByPathStmt = this.db.prepare(`
      SELECT id, file_path, duration, event_count, file_size, vehicle_count, start_time, created_at
      FROM recordings
      WHERE file_path = ?
    `);

    this.deleteRecordingStmt = this.db.prepare(`
      DELETE FROM recordings WHERE id = ?
    `);

    logger.info(`StateStore initialized at ${dbPath}`);
  }

  // ─── Migrations ──────────────────────────────────────────────────

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT DEFAULT (datetime('now')),
        vehicles TEXT,
        fleets TEXT,
        geofences TEXT,
        incidents TEXT,
        analytics TEXT
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analytics_history (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT    NOT NULL,
        summary   TEXT    NOT NULL,
        fleets    TEXT    NOT NULL
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_analytics_history_timestamp
        ON analytics_history (timestamp)
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS recordings (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path     TEXT UNIQUE NOT NULL,
        duration      REAL    NOT NULL,
        event_count   INTEGER NOT NULL,
        file_size     INTEGER NOT NULL,
        vehicle_count INTEGER NOT NULL,
        start_time    TEXT    NOT NULL,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  // ─── Snapshot methods ────────────────────────────────────────────

  saveSnapshot(data: SnapshotData): SnapshotMeta {
    const result = this.insertSnapshotStmt.run(data);
    const id = Number(result.lastInsertRowid);
    const row = this.db.prepare("SELECT created_at FROM snapshots WHERE id = ?").get(id) as
      | { created_at: string }
      | undefined;
    return { id, created_at: row?.created_at ?? new Date().toISOString() };
  }

  getLatestSnapshot(): SnapshotRow | null {
    const row = this.latestSnapshotStmt.get() as SnapshotRow | undefined;
    return row ?? null;
  }

  listSnapshots(limit: number = 20): SnapshotMeta[] {
    return this.listSnapshotsStmt.all(limit) as SnapshotMeta[];
  }

  deleteOldSnapshots(keepCount: number): number {
    const result = this.deleteOldSnapshotsStmt.run(keepCount);
    return result.changes;
  }

  // ─── Analytics history methods ───────────────────────────────────

  insertAnalytics(snapshot: {
    summary: AnalyticsSummary;
    fleets: FleetAnalytics[];
    timestamp?: number;
  }): void {
    const ts = new Date(snapshot.timestamp ?? Date.now()).toISOString();
    this.insertAnalyticsStmt.run(
      ts,
      JSON.stringify(snapshot.summary),
      JSON.stringify(snapshot.fleets)
    );
  }

  /**
   * Reads the analytics time series for a window.
   *
   * The returned array is the payload; its non-enumerable `meta` property
   * reports what was left out. Two rules matter:
   *
   * - **Truncation keeps the newest.** When the window holds more rows than
   *   `limit`, the OLD end is dropped, never the recent end, so a limited query
   *   over a wide range still ends at "now". (Before this method was fixed the
   *   opposite was true: `ORDER BY timestamp ASC ... LIMIT ?` silently returned
   *   ancient history and hid everything after it.)
   * - **Nothing is dropped silently.** `meta.truncated`, `meta.matched` and
   *   `meta.omitted` always describe the gap between the window and the payload.
   *
   * @param from  ISO lower bound (inclusive), unbounded when omitted.
   * @param to    ISO upper bound (inclusive), unbounded when omitted.
   * @param limit Max entries; clamped to [1, 10000].
   * @param options `order` for payload ordering, `bucket` to downsample.
   */
  getAnalyticsHistory(
    from?: string,
    to?: string,
    limit: number = 1000,
    options: AnalyticsHistoryOptions = {}
  ): AnalyticsHistoryResult {
    const effectiveLimit = Math.min(Math.max(1, Math.floor(limit) || 1), MAX_ANALYTICS_LIMIT);
    const order: AnalyticsOrder = options.order === "desc" ? "desc" : "asc";
    const lower = from ?? MIN_TIMESTAMP;
    const upper = to ?? MAX_TIMESTAMP;

    const stats = this.analyticsRangeStatsStmt.get(lower, upper) as {
      count: number;
      min_ts: string | null;
      max_ts: string | null;
    };

    const base = {
      matched: stats.count,
      anchor: "newest" as const,
      limit: effectiveLimit,
      order,
      from: from ?? null,
      to: to ?? null,
      windowFrom: stats.min_ts,
      windowTo: stats.max_ts,
    };

    const bucketSpec = options.bucket ?? null;
    if (bucketSpec !== null) {
      return this.readBucketed(lower, upper, effectiveLimit, order, bucketSpec, stats, base);
    }

    const raw = this.selectAnalyticsDescStmt.all(lower, upper, effectiveLimit) as RawAnalyticsRow[];
    const rows = raw.map(decodeRow);
    if (order === "asc") rows.reverse();

    const coveredFrom = raw.length > 0 ? raw[raw.length - 1].timestamp : null;
    const coveredTo = raw.length > 0 ? raw[0].timestamp : null;

    return withMeta(rows, {
      ...base,
      scanned: raw.length,
      returned: rows.length,
      omitted: Math.max(0, stats.count - raw.length),
      truncated: stats.count > raw.length,
      coveredFrom,
      coveredTo,
      bucket: null,
    });
  }

  /**
   * Downsampled read: streams stored rows newest-first and folds them into
   * fixed-width time buckets, stopping as soon as `limit` buckets are complete.
   * A 24 h window therefore costs a bounded scan instead of shipping every
   * sample for the client to thin.
   */
  private readBucketed(
    lower: string,
    upper: string,
    effectiveLimit: number,
    order: AnalyticsOrder,
    bucketSpec: string | number,
    stats: { count: number; min_ts: string | null; max_ts: string | null },
    base: Omit<
      AnalyticsHistoryMeta,
      "scanned" | "returned" | "omitted" | "truncated" | "coveredFrom" | "coveredTo" | "bucket"
    >
  ): AnalyticsHistoryResult {
    const parsed = parseBucketSpec(bucketSpec);
    if (parsed === null) {
      throw new Error(
        `Invalid bucket "${bucketSpec}": expected "auto", a duration (30s, 5m, 1h, 1d) or milliseconds between ${MIN_BUCKET_MS} and ${MAX_BUCKET_MS}`
      );
    }

    const auto = parsed === "auto";
    const spanMs =
      stats.min_ts && stats.max_ts
        ? Math.max(1, Date.parse(stats.max_ts) - Date.parse(stats.min_ts))
        : 0;
    const durationMs =
      parsed === "auto"
        ? // With no data to measure, fall back to the ladder's 1 m step.
          pickAutoBucket(spanMs || 60_000 * effectiveLimit, effectiveLimit)
        : parsed;

    const accumulators: BucketAccumulator[] = [];
    let current: BucketAccumulator | null = null;
    let scanned = 0;
    let stoppedEarly = false;

    const iterator = this.selectAnalyticsDescStmt.iterate(
      lower,
      upper,
      MAX_BUCKET_SCAN_ROWS
    ) as IterableIterator<RawAnalyticsRow>;

    for (const raw of iterator) {
      const decoded = decodeRow(raw);
      const key = Math.floor(Date.parse(raw.timestamp) / durationMs) * durationMs;

      if (!current || current.key !== key) {
        if (accumulators.length >= effectiveLimit) {
          // `limit` buckets are already complete and this row belongs to an
          // older one — everything below is outside the requested budget.
          // Breaking closes the SQLite cursor via the iterator protocol.
          stoppedEarly = true;
          break;
        }
        current = {
          key,
          latest: decoded,
          oldestTimestamp: raw.timestamp,
          sampleCount: 0,
          activeVehicles: 0,
          avgSpeed: 0,
          avgRouteEfficiency: 0,
          fleets: new Map(),
        };
        accumulators.push(current);
      }

      accumulate(current, decoded);
      scanned += 1;

      if (scanned >= MAX_BUCKET_SCAN_ROWS) {
        stoppedEarly = true;
        break;
      }
    }

    const rows = accumulators.map((acc) => finalizeBucket(acc, durationMs));
    if (order === "asc") rows.reverse();

    const newest = accumulators[0];
    const oldest = accumulators[accumulators.length - 1];

    return withMeta(rows, {
      ...base,
      scanned,
      returned: rows.length,
      omitted: Math.max(0, stats.count - scanned),
      truncated: stoppedEarly || stats.count > scanned,
      coveredFrom: oldest ? oldest.oldestTimestamp : null,
      coveredTo: newest ? newest.latest.timestamp : null,
      bucket: {
        durationMs,
        label: formatBucketLabel(durationMs),
        count: rows.length,
        sampleCount: scanned,
        auto,
        aggregation: ANALYTICS_BUCKET_AGGREGATION,
      },
    });
  }

  pruneAnalyticsHistory(olderThan: string): number {
    const result = this.pruneAnalyticsStmt.run(olderThan);
    return result.changes;
  }

  getAnalyticsHistoryCount(): number {
    const row = this.countAnalyticsStmt.get() as { count: number };
    return row.count;
  }

  // ─── Recording methods ───────────────────────────────────────────

  insertRecording(metadata: RecordingMetadata): number {
    const result = this.insertRecordingStmt.run({
      file_path: metadata.filePath,
      duration: metadata.duration,
      event_count: metadata.eventCount,
      file_size: metadata.fileSize,
      vehicle_count: metadata.vehicleCount,
      start_time: metadata.startTime,
    });
    return Number(result.lastInsertRowid);
  }

  getRecordings(): RecordingRow[] {
    return this.getRecordingsStmt.all() as RecordingRow[];
  }

  getRecording(id: number): RecordingRow | undefined {
    return this.getRecordingStmt.get(id) as RecordingRow | undefined;
  }

  getRecordingByPath(filePath: string): RecordingRow | undefined {
    return this.getRecordingByPathStmt.get(filePath) as RecordingRow | undefined;
  }

  deleteRecording(id: number): string | undefined {
    const row = this.getRecording(id);
    if (!row) return undefined;
    this.deleteRecordingStmt.run(id);
    return row.file_path;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────

  close(): void {
    this.db.close();
    logger.info("StateStore closed");
  }
}
