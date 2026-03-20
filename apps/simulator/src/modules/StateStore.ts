import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import logger from "../utils/logger";
import type { AnalyticsSummary, FleetAnalytics, RecordingMetadata } from "../types";

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

export interface AnalyticsHistoryRow {
  id: number;
  timestamp: string;
  summary: AnalyticsSummary;
  fleets: FleetAnalytics[];
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
  private selectAnalyticsRangeStmt: Database.Statement;
  private selectAnalyticsAllStmt: Database.Statement;
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

    this.selectAnalyticsRangeStmt = this.db.prepare(
      `SELECT id, timestamp, summary, fleets FROM analytics_history
       WHERE timestamp >= ? AND timestamp <= ?
       ORDER BY timestamp ASC
       LIMIT ?`
    );

    this.selectAnalyticsAllStmt = this.db.prepare(
      `SELECT id, timestamp, summary, fleets FROM analytics_history
       ORDER BY timestamp ASC
       LIMIT ?`
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

  getAnalyticsHistory(from?: string, to?: string, limit: number = 1000): AnalyticsHistoryRow[] {
    const effectiveLimit = Math.min(Math.max(1, limit), 10000);

    let rows: Array<{ id: number; timestamp: string; summary: string; fleets: string }>;

    if (from && to) {
      rows = this.selectAnalyticsRangeStmt.all(from, to, effectiveLimit) as typeof rows;
    } else if (from) {
      rows = this.selectAnalyticsRangeStmt.all(
        from,
        "9999-12-31T23:59:59.999Z",
        effectiveLimit
      ) as typeof rows;
    } else if (to) {
      rows = this.selectAnalyticsRangeStmt.all(
        "1970-01-01T00:00:00.000Z",
        to,
        effectiveLimit
      ) as typeof rows;
    } else {
      rows = this.selectAnalyticsAllStmt.all(effectiveLimit) as typeof rows;
    }

    return rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      summary: JSON.parse(row.summary) as AnalyticsSummary,
      fleets: JSON.parse(row.fleets) as FleetAnalytics[],
    }));
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
