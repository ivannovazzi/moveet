import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { StateStore } from "../modules/StateStore";
import type { SnapshotData } from "../modules/StateStore";
import type { AnalyticsSummary, FleetAnalytics, RecordingMetadata } from "../types";

// ─── Snapshot helpers ──────────────────────────────────────────────

function makeSnapshot(tag: string = "default"): SnapshotData {
  return {
    vehicles: JSON.stringify([{ id: `v-${tag}`, position: [1, 2] }]),
    fleets: JSON.stringify([{ id: `f-${tag}`, name: "Fleet" }]),
    geofences: JSON.stringify([]),
    incidents: JSON.stringify([]),
    analytics: JSON.stringify({ summary: { totalVehicles: 1 } }),
  };
}

// ─── Analytics helpers ─────────────────────────────────────────────

function makeSummary(overrides?: Partial<AnalyticsSummary>): AnalyticsSummary {
  return {
    totalVehicles: 10,
    activeVehicles: 5,
    totalDistanceTraveled: 42.5,
    avgSpeed: 35.2,
    totalIdleTime: 120,
    avgRouteEfficiency: 0.92,
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeFleets(count = 1): FleetAnalytics[] {
  return Array.from({ length: count }, (_, i) => ({
    fleetId: `fleet-${i}`,
    vehicleCount: 5,
    activeCount: 3,
    totalDistance: 20,
    avgSpeed: 30,
    totalIdleTime: 60,
    routeEfficiency: 0.9,
    vehicles: [],
  }));
}

// ─── Recording helpers ─────────────────────────────────────────────

function makeRecording(overrides: Partial<RecordingMetadata> = {}): RecordingMetadata {
  return {
    filePath: "recordings/test-recording.ndjson",
    startTime: "2026-03-20T12:00:00.000Z",
    duration: 60000,
    eventCount: 500,
    fileSize: 102400,
    vehicleCount: 10,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("StateStore — snapshots", () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("should save and retrieve a snapshot", () => {
    const data = makeSnapshot("1");
    const meta = store.saveSnapshot(data);

    expect(meta.id).toBe(1);
    expect(meta.created_at).toBeDefined();

    const latest = store.getLatestSnapshot();
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(1);
    expect(latest!.vehicles).toBe(data.vehicles);
    expect(latest!.fleets).toBe(data.fleets);
    expect(latest!.geofences).toBe(data.geofences);
    expect(latest!.incidents).toBe(data.incidents);
    expect(latest!.analytics).toBe(data.analytics);
  });

  it("should return the most recent snapshot from getLatestSnapshot", () => {
    store.saveSnapshot(makeSnapshot("first"));
    store.saveSnapshot(makeSnapshot("second"));
    store.saveSnapshot(makeSnapshot("third"));

    const latest = store.getLatestSnapshot();
    expect(latest).not.toBeNull();
    const vehicles = JSON.parse(latest!.vehicles);
    expect(vehicles[0].id).toBe("v-third");
  });

  it("should return null when no snapshots exist", () => {
    const latest = store.getLatestSnapshot();
    expect(latest).toBeNull();
  });

  it("should list recent snapshots with metadata only", () => {
    store.saveSnapshot(makeSnapshot("a"));
    store.saveSnapshot(makeSnapshot("b"));
    store.saveSnapshot(makeSnapshot("c"));

    const list = store.listSnapshots(2);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(3);
    expect(list[1].id).toBe(2);
    expect((list[0] as unknown as Record<string, unknown>).vehicles).toBeUndefined();
  });

  it("should delete old snapshots keeping only N most recent", () => {
    for (let i = 0; i < 10; i++) {
      store.saveSnapshot(makeSnapshot(`${i}`));
    }

    const deleted = store.deleteOldSnapshots(3);
    expect(deleted).toBe(7);

    const remaining = store.listSnapshots(20);
    expect(remaining).toHaveLength(3);
    expect(remaining[0].id).toBe(10);
    expect(remaining[2].id).toBe(8);
  });

  it("should handle deleteOldSnapshots when there are fewer rows than keepCount", () => {
    store.saveSnapshot(makeSnapshot("only"));
    const deleted = store.deleteOldSnapshots(5);
    expect(deleted).toBe(0);

    const remaining = store.listSnapshots(20);
    expect(remaining).toHaveLength(1);
  });

  it("should assign auto-incrementing IDs", () => {
    const m1 = store.saveSnapshot(makeSnapshot("a"));
    const m2 = store.saveSnapshot(makeSnapshot("b"));
    expect(m2.id).toBeGreaterThan(m1.id);
  });
});

describe("StateStore — analytics_history", () => {
  let store: StateStore;
  let dbPath: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "statestore-analytics-"));
    dbPath = path.join(tmpDir, "test.db");
    store = new StateStore(dbPath);
  });

  afterEach(() => {
    store.close();
    const dir = path.dirname(dbPath);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("starts with empty history", () => {
    const history = store.getAnalyticsHistory();
    expect(history).toEqual([]);
    expect(store.getAnalyticsHistoryCount()).toBe(0);
  });

  it("inserts and retrieves analytics snapshots", () => {
    const summary = makeSummary();
    const fleets = makeFleets(2);
    const ts = Date.now();

    store.insertAnalytics({ summary, fleets, timestamp: ts });

    const history = store.getAnalyticsHistory();
    expect(history).toHaveLength(1);
    expect(history[0].summary).toEqual(summary);
    expect(history[0].fleets).toEqual(fleets);
    expect(history[0].id).toBe(1);
    expect(typeof history[0].timestamp).toBe("string");
  });

  it("preserves insertion order (ASC by timestamp)", () => {
    const base = Date.now();
    store.insertAnalytics({
      summary: makeSummary({ totalVehicles: 1 }),
      fleets: [],
      timestamp: base,
    });
    store.insertAnalytics({
      summary: makeSummary({ totalVehicles: 2 }),
      fleets: [],
      timestamp: base + 5000,
    });
    store.insertAnalytics({
      summary: makeSummary({ totalVehicles: 3 }),
      fleets: [],
      timestamp: base + 10000,
    });

    const history = store.getAnalyticsHistory();
    expect(history).toHaveLength(3);
    expect(history[0].summary.totalVehicles).toBe(1);
    expect(history[1].summary.totalVehicles).toBe(2);
    expect(history[2].summary.totalVehicles).toBe(3);
  });

  it("filters by from date", () => {
    const t1 = new Date("2025-01-01T00:00:00Z").getTime();
    const t2 = new Date("2025-06-01T00:00:00Z").getTime();
    const t3 = new Date("2025-12-01T00:00:00Z").getTime();

    store.insertAnalytics({
      summary: makeSummary({ totalVehicles: 1 }),
      fleets: [],
      timestamp: t1,
    });
    store.insertAnalytics({
      summary: makeSummary({ totalVehicles: 2 }),
      fleets: [],
      timestamp: t2,
    });
    store.insertAnalytics({
      summary: makeSummary({ totalVehicles: 3 }),
      fleets: [],
      timestamp: t3,
    });

    const history = store.getAnalyticsHistory("2025-06-01T00:00:00.000Z");
    expect(history).toHaveLength(2);
    expect(history[0].summary.totalVehicles).toBe(2);
    expect(history[1].summary.totalVehicles).toBe(3);
  });

  it("filters by to date", () => {
    const t1 = new Date("2025-01-01T00:00:00Z").getTime();
    const t2 = new Date("2025-06-01T00:00:00Z").getTime();
    const t3 = new Date("2025-12-01T00:00:00Z").getTime();

    store.insertAnalytics({
      summary: makeSummary({ totalVehicles: 1 }),
      fleets: [],
      timestamp: t1,
    });
    store.insertAnalytics({
      summary: makeSummary({ totalVehicles: 2 }),
      fleets: [],
      timestamp: t2,
    });
    store.insertAnalytics({
      summary: makeSummary({ totalVehicles: 3 }),
      fleets: [],
      timestamp: t3,
    });

    const history = store.getAnalyticsHistory(undefined, "2025-06-01T00:00:00.000Z");
    expect(history).toHaveLength(2);
    expect(history[0].summary.totalVehicles).toBe(1);
    expect(history[1].summary.totalVehicles).toBe(2);
  });

  it("filters by from and to date range", () => {
    const t1 = new Date("2025-01-01T00:00:00Z").getTime();
    const t2 = new Date("2025-06-01T00:00:00Z").getTime();
    const t3 = new Date("2025-09-01T00:00:00Z").getTime();
    const t4 = new Date("2025-12-01T00:00:00Z").getTime();

    store.insertAnalytics({
      summary: makeSummary({ totalVehicles: 1 }),
      fleets: [],
      timestamp: t1,
    });
    store.insertAnalytics({
      summary: makeSummary({ totalVehicles: 2 }),
      fleets: [],
      timestamp: t2,
    });
    store.insertAnalytics({
      summary: makeSummary({ totalVehicles: 3 }),
      fleets: [],
      timestamp: t3,
    });
    store.insertAnalytics({
      summary: makeSummary({ totalVehicles: 4 }),
      fleets: [],
      timestamp: t4,
    });

    const history = store.getAnalyticsHistory(
      "2025-03-01T00:00:00.000Z",
      "2025-10-01T00:00:00.000Z"
    );
    expect(history).toHaveLength(2);
    expect(history[0].summary.totalVehicles).toBe(2);
    expect(history[1].summary.totalVehicles).toBe(3);
  });

  it("respects limit parameter", () => {
    for (let i = 0; i < 10; i++) {
      store.insertAnalytics({
        summary: makeSummary({ totalVehicles: i }),
        fleets: [],
        timestamp: Date.now() + i * 1000,
      });
    }

    const history = store.getAnalyticsHistory(undefined, undefined, 3);
    expect(history).toHaveLength(3);
    expect(history[0].summary.totalVehicles).toBe(0);
    expect(history[2].summary.totalVehicles).toBe(2);
  });

  it("clamps limit to [1, 10000]", () => {
    store.insertAnalytics({ summary: makeSummary(), fleets: [] });

    const h1 = store.getAnalyticsHistory(undefined, undefined, 0);
    expect(h1).toHaveLength(1);

    const h2 = store.getAnalyticsHistory(undefined, undefined, -5);
    expect(h2).toHaveLength(1);
  });

  it("prunes entries older than a given date", () => {
    const t1 = new Date("2025-01-01T00:00:00Z").getTime();
    const t2 = new Date("2025-06-01T00:00:00Z").getTime();
    const t3 = new Date("2025-12-01T00:00:00Z").getTime();

    store.insertAnalytics({
      summary: makeSummary({ totalVehicles: 1 }),
      fleets: [],
      timestamp: t1,
    });
    store.insertAnalytics({
      summary: makeSummary({ totalVehicles: 2 }),
      fleets: [],
      timestamp: t2,
    });
    store.insertAnalytics({
      summary: makeSummary({ totalVehicles: 3 }),
      fleets: [],
      timestamp: t3,
    });

    const pruned = store.pruneAnalyticsHistory("2025-06-01T00:00:00.000Z");
    expect(pruned).toBe(1);

    const remaining = store.getAnalyticsHistory();
    expect(remaining).toHaveLength(2);
    expect(remaining[0].summary.totalVehicles).toBe(2);
  });

  it("getAnalyticsHistoryCount returns correct count", () => {
    expect(store.getAnalyticsHistoryCount()).toBe(0);

    store.insertAnalytics({ summary: makeSummary(), fleets: [] });
    store.insertAnalytics({ summary: makeSummary(), fleets: [] });
    store.insertAnalytics({ summary: makeSummary(), fleets: [] });

    expect(store.getAnalyticsHistoryCount()).toBe(3);
  });

  it("uses current time when timestamp is not provided", () => {
    const before = new Date().toISOString();
    store.insertAnalytics({ summary: makeSummary(), fleets: [] });
    const after = new Date().toISOString();

    const history = store.getAnalyticsHistory();
    expect(history).toHaveLength(1);
    expect(history[0].timestamp >= before).toBe(true);
    expect(history[0].timestamp <= after).toBe(true);
  });

  it("survives re-opening (data persists)", () => {
    store.insertAnalytics({ summary: makeSummary({ totalVehicles: 42 }), fleets: makeFleets() });
    store.close();

    store = new StateStore(dbPath);
    const history = store.getAnalyticsHistory();
    expect(history).toHaveLength(1);
    expect(history[0].summary.totalVehicles).toBe(42);
    expect(history[0].fleets).toHaveLength(1);
  });
});

describe("StateStore — recordings", () => {
  let store: StateStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "statestore-recordings-"));
    store = new StateStore(path.join(tmpDir, "test.db"));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should insert a recording and retrieve it by id", () => {
    const meta = makeRecording();
    const id = store.insertRecording(meta);

    expect(id).toBeGreaterThan(0);

    const row = store.getRecording(id);
    expect(row).toBeDefined();
    expect(row!.file_path).toBe(meta.filePath);
    expect(row!.duration).toBe(meta.duration);
    expect(row!.event_count).toBe(meta.eventCount);
    expect(row!.file_size).toBe(meta.fileSize);
    expect(row!.vehicle_count).toBe(meta.vehicleCount);
    expect(row!.start_time).toBe(meta.startTime);
    expect(row!.created_at).toBeDefined();
  });

  it("should return undefined for non-existent id", () => {
    expect(store.getRecording(999)).toBeUndefined();
  });

  it("should return all recordings ordered by id DESC", () => {
    store.insertRecording(makeRecording({ filePath: "recordings/a.ndjson" }));
    store.insertRecording(makeRecording({ filePath: "recordings/b.ndjson" }));
    store.insertRecording(makeRecording({ filePath: "recordings/c.ndjson" }));

    const rows = store.getRecordings();
    expect(rows).toHaveLength(3);
    expect(rows[0].file_path).toBe("recordings/c.ndjson");
    expect(rows[2].file_path).toBe("recordings/a.ndjson");
  });

  it("should return empty array when no recordings exist", () => {
    expect(store.getRecordings()).toEqual([]);
  });

  it("should delete recording and return file_path", () => {
    const id = store.insertRecording(makeRecording());
    const filePath = store.deleteRecording(id);

    expect(filePath).toBe("recordings/test-recording.ndjson");
    expect(store.getRecording(id)).toBeUndefined();
  });

  it("should return undefined for non-existent delete", () => {
    expect(store.deleteRecording(999)).toBeUndefined();
  });

  it("should throw on duplicate file_path insert", () => {
    store.insertRecording(makeRecording());
    expect(() => store.insertRecording(makeRecording())).toThrow();
  });

  it("should find recording by file path", () => {
    const meta = makeRecording({ filePath: "recordings/by-path.ndjson" });
    const id = store.insertRecording(meta);

    const row = store.getRecordingByPath("recordings/by-path.ndjson");
    expect(row).toBeDefined();
    expect(row!.id).toBe(id);
  });

  it("should return undefined for non-existent path", () => {
    expect(store.getRecordingByPath("nope.ndjson")).toBeUndefined();
  });

  it("should store distinct metadata per recording", () => {
    const id1 = store.insertRecording(
      makeRecording({ filePath: "recordings/rec-1.ndjson", duration: 10000, vehicleCount: 5 })
    );
    const id2 = store.insertRecording(
      makeRecording({ filePath: "recordings/rec-2.ndjson", duration: 20000, vehicleCount: 15 })
    );

    const row1 = store.getRecording(id1)!;
    const row2 = store.getRecording(id2)!;

    expect(row1.duration).toBe(10000);
    expect(row1.vehicle_count).toBe(5);
    expect(row2.duration).toBe(20000);
    expect(row2.vehicle_count).toBe(15);
  });
});
