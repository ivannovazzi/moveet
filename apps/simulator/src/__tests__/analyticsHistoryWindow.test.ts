import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import express from "express";
import request from "supertest";
import { createAnalyticsRoutes } from "../routes/analytics";
import {
  StateStore,
  formatBucketLabel,
  parseBucketSpec,
  type AnalyticsHistoryMeta,
  type AnalyticsHistoryRow,
} from "../modules/StateStore";
import type { RouteContext } from "../routes/types";
import type { AnalyticsSummary, FleetAnalytics } from "../types";

// ─── Fixtures ───────────────────────────────────────────────────────

const BASE = Date.parse("2025-03-01T00:00:00.000Z");

function makeSummary(overrides?: Partial<AnalyticsSummary>): AnalyticsSummary {
  return {
    totalVehicles: 10,
    activeVehicles: 5,
    totalDistanceTraveled: 100,
    avgSpeed: 30,
    totalIdleTime: 60,
    avgRouteEfficiency: 0.9,
    timestamp: BASE,
    ...overrides,
  };
}

function makeFleet(overrides?: Partial<FleetAnalytics>): FleetAnalytics {
  return {
    fleetId: "fleet-a",
    vehicleCount: 4,
    activeCount: 2,
    totalDistance: 40,
    avgSpeed: 25,
    totalIdleTime: 30,
    routeEfficiency: 0.8,
    vehicles: [],
    ...overrides,
  };
}

function createMockContext(stateStore?: StateStore): RouteContext {
  return {
    network: {} as RouteContext["network"],
    vehicleManager: {
      analytics: {
        getSummary: () => makeSummary(),
        getFleetStats: () => ({}),
        resetStats: () => {},
      },
    } as unknown as RouteContext["vehicleManager"],
    fleetManager: {} as RouteContext["fleetManager"],
    incidentManager: {} as RouteContext["incidentManager"],
    recordingManager: {} as RouteContext["recordingManager"],
    simulationController: {} as RouteContext["simulationController"],
    scenarioManager: {} as RouteContext["scenarioManager"],
    generationManager: {} as RouteContext["generationManager"],
    stateStore,
  };
}

/** Envelope body shape returned by `?envelope=true`. */
interface Envelope {
  meta: AnalyticsHistoryMeta;
  rows: AnalyticsHistoryRow[];
}

// ─── Bucket spec parsing ────────────────────────────────────────────

describe("parseBucketSpec", () => {
  it("parses durations and milliseconds", () => {
    expect(parseBucketSpec("30s")).toBe(30_000);
    expect(parseBucketSpec("5m")).toBe(300_000);
    expect(parseBucketSpec("1h")).toBe(3_600_000);
    expect(parseBucketSpec("1d")).toBe(86_400_000);
    expect(parseBucketSpec("60000")).toBe(60_000);
    expect(parseBucketSpec(90_000)).toBe(90_000);
    expect(parseBucketSpec("auto")).toBe("auto");
  });

  it("rejects nonsense and out-of-range widths", () => {
    expect(parseBucketSpec("banana")).toBeNull();
    expect(parseBucketSpec("5")).toBeNull(); // below the 1 s floor
    expect(parseBucketSpec("30d")).toBeNull(); // above the 7 d ceiling
    expect(parseBucketSpec("-1m")).toBeNull();
    expect(parseBucketSpec("")).toBeNull();
  });

  it("round-trips through formatBucketLabel", () => {
    expect(formatBucketLabel(30_000)).toBe("30s");
    expect(formatBucketLabel(300_000)).toBe("5m");
    expect(formatBucketLabel(3_600_000)).toBe("1h");
    expect(formatBucketLabel(86_400_000)).toBe("1d");
  });
});

// ─── StateStore.getAnalyticsHistory ─────────────────────────────────

describe("StateStore.getAnalyticsHistory — windowing", () => {
  let store: StateStore;
  let dbPath: string;

  /** Inserts `count` samples, `stepMs` apart, starting at BASE. */
  function seed(count: number, stepMs = 5_000): void {
    for (let i = 0; i < count; i++) {
      store.insertAnalytics({
        summary: makeSummary({
          totalVehicles: 10,
          activeVehicles: i,
          totalDistanceTraveled: i * 10,
          avgSpeed: i,
          totalIdleTime: i * 2,
          avgRouteEfficiency: 0.5,
        }),
        fleets: [
          makeFleet({
            activeCount: i,
            totalDistance: i * 4,
            avgSpeed: i,
            totalIdleTime: i,
            routeEfficiency: 0.5,
            vehicles: [{ id: `v-${i}` } as unknown as FleetAnalytics["vehicles"][number]],
          }),
        ],
        timestamp: BASE + i * stepMs,
      });
    }
  }

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "analytics-window-"));
    dbPath = path.join(tmpDir, "test.db");
    store = new StateStore(dbPath);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("a limited query over a wide range reaches the recent end", () => {
    seed(100);

    const rows = store.getAnalyticsHistory(
      new Date(BASE).toISOString(),
      new Date(BASE + 100 * 5_000).toISOString(),
      10
    );

    expect(rows).toHaveLength(10);
    // Ascending payload whose LAST row is the newest stored sample.
    expect(rows[9].summary.activeVehicles).toBe(99);
    expect(rows[9].timestamp).toBe(new Date(BASE + 99 * 5_000).toISOString());
    expect(rows[0].summary.activeVehicles).toBe(90);
    // Ordering within the payload is still ascending.
    expect(rows.map((r) => r.timestamp)).toEqual([...rows.map((r) => r.timestamp)].sort());
  });

  it("reports exactly what a limit dropped", () => {
    seed(100);

    const rows = store.getAnalyticsHistory(undefined, undefined, 10);

    expect(rows.meta.matched).toBe(100);
    expect(rows.meta.returned).toBe(10);
    expect(rows.meta.omitted).toBe(90);
    expect(rows.meta.truncated).toBe(true);
    expect(rows.meta.anchor).toBe("newest");
    expect(rows.meta.coveredFrom).toBe(new Date(BASE + 90 * 5_000).toISOString());
    expect(rows.meta.coveredTo).toBe(new Date(BASE + 99 * 5_000).toISOString());
    expect(rows.meta.windowFrom).toBe(new Date(BASE).toISOString());
    expect(rows.meta.bucket).toBeNull();
  });

  it("does not claim truncation when the whole window fits", () => {
    seed(5);

    const rows = store.getAnalyticsHistory(undefined, undefined, 10);

    expect(rows).toHaveLength(5);
    expect(rows.meta.truncated).toBe(false);
    expect(rows.meta.omitted).toBe(0);
    expect(rows.meta.matched).toBe(5);
  });

  it("reports the clamped limit rather than the requested one", () => {
    seed(3);

    expect(store.getAnalyticsHistory(undefined, undefined, 99_999).meta.limit).toBe(10_000);
    expect(store.getAnalyticsHistory(undefined, undefined, 0).meta.limit).toBe(1);
  });

  it("order=desc returns newest first over the same window", () => {
    seed(20);

    const rows = store.getAnalyticsHistory(undefined, undefined, 5, { order: "desc" });

    expect(rows).toHaveLength(5);
    expect(rows[0].summary.activeVehicles).toBe(19);
    expect(rows[4].summary.activeVehicles).toBe(15);
    expect(rows.meta.order).toBe("desc");
  });

  it("returns empty, honest metadata for an empty window", () => {
    const rows = store.getAnalyticsHistory("2030-01-01T00:00:00.000Z");

    expect(rows).toEqual([]);
    expect(rows.meta.matched).toBe(0);
    expect(rows.meta.truncated).toBe(false);
    expect(rows.meta.coveredFrom).toBeNull();
    expect(rows.meta.coveredTo).toBeNull();
  });

  it("keeps the meta property out of the JSON body", () => {
    seed(2);
    const rows = store.getAnalyticsHistory();

    expect(JSON.parse(JSON.stringify(rows))).toHaveLength(2);
    expect(JSON.stringify(rows).startsWith("[")).toBe(true);
    expect(Object.keys(rows)).toEqual(["0", "1"]);
  });
});

// ─── Bucketing ──────────────────────────────────────────────────────

describe("StateStore.getAnalyticsHistory — bucketing", () => {
  let store: StateStore;
  let dbPath: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "analytics-bucket-"));
    dbPath = path.join(tmpDir, "test.db");
    store = new StateStore(dbPath);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("folds counters with last and gauges with mean", () => {
    // Four samples inside one aligned minute: 00:00:00, 15, 30, 45.
    for (let i = 0; i < 4; i++) {
      store.insertAnalytics({
        summary: makeSummary({
          totalVehicles: 10 + i,
          activeVehicles: i, // gauge → mean of 0,1,2,3 = 1.5
          totalDistanceTraveled: 100 * (i + 1), // counter → last = 400
          avgSpeed: 10 * i, // gauge → mean of 0,10,20,30 = 15
          totalIdleTime: 5 * (i + 1), // counter → last = 20
          avgRouteEfficiency: 0.4 + i * 0.2, // gauge → mean = 0.7
        }),
        fleets: [
          makeFleet({
            vehicleCount: 4 + i,
            activeCount: i,
            totalDistance: 50 * (i + 1),
            avgSpeed: 10 * i,
            totalIdleTime: 2 * (i + 1),
            routeEfficiency: 0.4 + i * 0.2,
            vehicles: [{ id: `v-${i}` } as unknown as FleetAnalytics["vehicles"][number]],
          }),
        ],
        timestamp: BASE + i * 15_000,
      });
    }

    const rows = store.getAnalyticsHistory(undefined, undefined, 100, { bucket: "1m" });

    expect(rows).toHaveLength(1);
    const [row] = rows;

    // Gauges: arithmetic mean over the bucket's samples.
    expect(row.summary.activeVehicles).toBe(1.5);
    expect(row.summary.avgSpeed).toBe(15);
    expect(row.summary.avgRouteEfficiency).toBe(0.7);
    // Cumulative counters: the bucket's last value, never a mean.
    expect(row.summary.totalDistanceTraveled).toBe(400);
    expect(row.summary.totalIdleTime).toBe(20);
    // Slow-moving gauge: last value, not a fractional mean.
    expect(row.summary.totalVehicles).toBe(13);

    // The row is stamped at the bucket start, aligned to the epoch.
    expect(row.timestamp).toBe(new Date(BASE).toISOString());
    expect(row.summary.timestamp).toBe(BASE);

    // Fleets follow the same counter/gauge split.
    expect(row.fleets).toHaveLength(1);
    expect(row.fleets[0].activeCount).toBe(1.5);
    expect(row.fleets[0].avgSpeed).toBe(15);
    expect(row.fleets[0].routeEfficiency).toBe(0.7);
    expect(row.fleets[0].totalDistance).toBe(200);
    expect(row.fleets[0].totalIdleTime).toBe(8);
    expect(row.fleets[0].vehicleCount).toBe(7);
    // Per-vehicle stats are carried through from the newest sample verbatim.
    expect(row.fleets[0].vehicles).toEqual([{ id: "v-3" }]);
  });

  it("stamps every bucketed row with its provenance", () => {
    for (let i = 0; i < 6; i++) {
      store.insertAnalytics({
        summary: makeSummary(),
        fleets: [],
        timestamp: BASE + i * 30_000, // 6 samples across 3 minutes
      });
    }

    const rows = store.getAnalyticsHistory(undefined, undefined, 100, { bucket: "1m" });

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.bucket).toBeDefined();
      expect(row.bucket?.durationMs).toBe(60_000);
      expect(row.bucket?.label).toBe("1m");
      expect(row.bucket?.sampleCount).toBe(2);
      expect(Date.parse(row.bucket!.end) - Date.parse(row.bucket!.start)).toBe(60_000);
      expect(row.bucket!.firstTimestamp <= row.bucket!.lastTimestamp).toBe(true);
    }
    expect(rows.meta.bucket).toMatchObject({
      durationMs: 60_000,
      label: "1m",
      count: 3,
      sampleCount: 6,
      auto: false,
    });
    expect(rows.meta.bucket?.aggregation["summary.totalDistanceTraveled"]).toContain("last");
    expect(rows.meta.bucket?.aggregation["summary.avgSpeed"]).toBe("mean");
    expect(rows.meta.truncated).toBe(false);
    expect(rows.meta.omitted).toBe(0);
  });

  it("covers the whole window with far fewer rows than samples", () => {
    // 12 h of 1-minute samples. Raw, this exceeds any sane wire budget; the
    // point of bucketing is that the caller still sees the whole window.
    const count = 720;
    for (let i = 0; i < count; i++) {
      store.insertAnalytics({
        summary: makeSummary({ activeVehicles: i }),
        fleets: [],
        timestamp: BASE + i * 60_000,
      });
    }

    const rows = store.getAnalyticsHistory(undefined, undefined, 500, { bucket: "5m" });

    // 12 h / 5 m = 144 buckets — the whole window, well under the limit.
    expect(rows).toHaveLength(144);
    expect(rows.meta.truncated).toBe(false);
    expect(rows.meta.matched).toBe(count);
    expect(rows.meta.scanned).toBe(count);
    // The payload spans window start to window end.
    expect(rows[0].timestamp).toBe(new Date(BASE).toISOString());
    expect(rows[143].summary.activeVehicles).toBe(717); // mean of samples 715..719
    expect(rows[143].bucket?.lastTimestamp).toBe(new Date(BASE + 719 * 60_000).toISOString());
  });

  it("truncates buckets from the old end and says so", () => {
    for (let i = 0; i < 600; i++) {
      store.insertAnalytics({
        summary: makeSummary({ activeVehicles: i }),
        fleets: [],
        timestamp: BASE + i * 60_000, // 10 h of 1-minute samples
      });
    }

    const rows = store.getAnalyticsHistory(undefined, undefined, 10, { bucket: "1m" });

    expect(rows).toHaveLength(10);
    expect(rows.meta.truncated).toBe(true);
    expect(rows.meta.matched).toBe(600);
    expect(rows.meta.scanned).toBe(10);
    expect(rows.meta.omitted).toBe(590);
    // The 10 buckets kept are the newest ones.
    expect(rows[9].summary.activeVehicles).toBe(599);
    expect(rows[0].summary.activeVehicles).toBe(590);
  });

  it("bucket=auto picks a width that fits the limit", () => {
    for (let i = 0; i < 720; i++) {
      store.insertAnalytics({
        summary: makeSummary(),
        fleets: [],
        timestamp: BASE + i * 60_000, // 12 h of 1-minute samples
      });
    }

    const rows = store.getAnalyticsHistory(undefined, undefined, 100, { bucket: "auto" });

    expect(rows.meta.bucket?.auto).toBe(true);
    // 12 h over 100 buckets → ≥ 432 s ideal → the ladder's 15 m step.
    expect(rows.meta.bucket?.label).toBe("15m");
    expect(rows.length).toBeLessThanOrEqual(100);
    expect(rows.meta.truncated).toBe(false);
  });

  it("rejects an unparseable bucket", () => {
    expect(() => store.getAnalyticsHistory(undefined, undefined, 10, { bucket: "banana" })).toThrow(
      /Invalid bucket/
    );
  });
});

// ─── HTTP surface ───────────────────────────────────────────────────

describe("GET /analytics/history — truncation contract", () => {
  let store: StateStore;
  let dbPath: string;
  let app: express.Express;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "analytics-route-window-"));
    dbPath = path.join(tmpDir, "test.db");
    store = new StateStore(dbPath);
    app = express();
    app.use(createAnalyticsRoutes(createMockContext(store)));

    for (let i = 0; i < 100; i++) {
      store.insertAnalytics({
        summary: makeSummary({ activeVehicles: i }),
        fleets: [],
        timestamp: BASE + i * 5_000,
      });
    }
  });

  afterEach(() => {
    store.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("keeps the legacy ?from=&limit= call shape working and reaching now", async () => {
    const res = await request(app).get(
      `/analytics/history?from=${encodeURIComponent(new Date(BASE).toISOString())}&limit=10`
    );

    expect(res.status).toBe(200);
    // Still a bare array — no envelope unless asked for.
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(10);
    expect(res.body[9].summary.activeVehicles).toBe(99);
  });

  it("announces truncation in the response headers", async () => {
    const res = await request(app).get("/analytics/history?limit=10");

    expect(res.headers["x-analytics-matched"]).toBe("100");
    expect(res.headers["x-analytics-returned"]).toBe("10");
    expect(res.headers["x-analytics-omitted"]).toBe("90");
    expect(res.headers["x-analytics-truncated"]).toBe("true");
    expect(res.headers["x-analytics-anchor"]).toBe("newest");
    expect(res.headers["x-analytics-bucket"]).toBe("none");
    expect(res.headers["access-control-expose-headers"]).toContain("X-Analytics-Truncated");
  });

  it("reports truncated=false when nothing was dropped", async () => {
    const res = await request(app).get("/analytics/history?limit=1000");

    expect(res.headers["x-analytics-truncated"]).toBe("false");
    expect(res.headers["x-analytics-omitted"]).toBe("0");
    expect(res.body).toHaveLength(100);
  });

  it("returns metadata in the body with envelope=true", async () => {
    const res = await request(app).get("/analytics/history?limit=10&envelope=true");
    const body = res.body as Envelope;

    expect(res.status).toBe(200);
    expect(body.rows).toHaveLength(10);
    expect(body.meta).toMatchObject({
      matched: 100,
      returned: 10,
      omitted: 90,
      truncated: true,
      anchor: "newest",
      limit: 10,
      order: "asc",
      bucket: null,
    });
  });

  it("serves bucketed rows with bucket metadata", async () => {
    const res = await request(app).get("/analytics/history?bucket=1m&envelope=true");
    const body = res.body as Envelope;

    expect(res.status).toBe(200);
    // 100 samples, 5 s apart = 500 s ≈ 9 buckets of a minute.
    expect(body.rows.length).toBeLessThan(100);
    expect(body.meta.bucket?.label).toBe("1m");
    expect(body.meta.bucket?.sampleCount).toBe(100);
    expect(body.meta.bucket?.aggregation).toBeDefined();
    expect(body.rows[0].bucket?.sampleCount).toBeGreaterThan(0);
    expect(res.headers["x-analytics-bucket"]).toBe("1m");
  });

  it("orders descending on request", async () => {
    const res = await request(app).get("/analytics/history?limit=3&order=desc");

    expect(res.body.map((r: AnalyticsHistoryRow) => r.summary.activeVehicles)).toEqual([
      99, 98, 97,
    ]);
  });

  it("rejects an invalid order", async () => {
    const res = await request(app).get("/analytics/history?order=sideways");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/order/);
  });

  it("rejects an invalid bucket", async () => {
    const res = await request(app).get("/analytics/history?bucket=banana");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bucket/);
  });

  it("still answers 503 when persistence is disabled", async () => {
    const disabled = express();
    disabled.use(createAnalyticsRoutes(createMockContext(undefined)));

    for (const query of ["", "?limit=10", "?bucket=1m", "?order=desc&envelope=true"]) {
      const res = await request(disabled).get(`/analytics/history${query}`);
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/not enabled/);
    }
  });
});
