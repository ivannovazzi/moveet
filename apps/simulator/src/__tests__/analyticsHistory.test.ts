import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import express from "express";
import request from "supertest";
import { createAnalyticsRoutes } from "../routes/analytics";
import { StateStore } from "../modules/StateStore";
import type { RouteContext } from "../routes/types";
import type { AnalyticsSummary } from "../types";

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
    stateStore,
  };
}

describe("GET /analytics/history", () => {
  let store: StateStore;
  let dbPath: string;
  let app: express.Express;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "analytics-route-test-"));
    dbPath = path.join(tmpDir, "test.db");
    store = new StateStore(dbPath);

    app = express();
    app.use(createAnalyticsRoutes(createMockContext(store)));
  });

  afterEach(() => {
    store.close();
    const dir = path.dirname(dbPath);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty array when no history exists", async () => {
    const res = await request(app).get("/analytics/history");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns inserted analytics snapshots", async () => {
    store.insertAnalytics({
      summary: makeSummary({ totalVehicles: 42 }),
      fleets: [],
      timestamp: Date.now(),
    });

    const res = await request(app).get("/analytics/history");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].summary.totalVehicles).toBe(42);
  });

  it("filters by from parameter", async () => {
    const t1 = new Date("2025-01-01T00:00:00Z").getTime();
    const t2 = new Date("2025-06-01T00:00:00Z").getTime();

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

    const res = await request(app).get("/analytics/history?from=2025-03-01T00:00:00.000Z");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].summary.totalVehicles).toBe(2);
  });

  it("filters by to parameter", async () => {
    const t1 = new Date("2025-01-01T00:00:00Z").getTime();
    const t2 = new Date("2025-06-01T00:00:00Z").getTime();

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

    const res = await request(app).get("/analytics/history?to=2025-03-01T00:00:00.000Z");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].summary.totalVehicles).toBe(1);
  });

  it("respects limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      store.insertAnalytics({
        summary: makeSummary({ totalVehicles: i }),
        fleets: [],
        timestamp: Date.now() + i * 1000,
      });
    }

    const res = await request(app).get("/analytics/history?limit=2");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("returns 400 for invalid limit", async () => {
    const res = await request(app).get("/analytics/history?limit=abc");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit/);
  });

  it("returns 400 for limit=0", async () => {
    const res = await request(app).get("/analytics/history?limit=0");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit/);
  });
});

describe("GET /analytics/history — persistence disabled", () => {
  it("returns 503 when stateStore is not provided", async () => {
    const app = express();
    app.use(createAnalyticsRoutes(createMockContext(undefined)));

    const res = await request(app).get("/analytics/history");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not enabled/);
  });
});
