import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createAnalyticsRoutes } from "../../routes/analytics";
import type { RouteContext } from "../../routes/types";

// Mock logger
vi.mock("../../utils/logger", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock rate limiter
vi.mock("../../middleware/rateLimiter", () => ({
  generalRateLimiter: {
    middleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    cleanup: vi.fn(),
  },
  expensiveRateLimiter: {
    middleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    cleanup: vi.fn(),
  },
}));

function createMockContext(opts: { withStateStore?: boolean } = {}): RouteContext {
  const stateStore = opts.withStateStore
    ? {
        getAnalyticsHistory: vi
          .fn()
          .mockReturnValue([{ timestamp: "2024-01-01T00:00:00Z", data: {} }]),
      }
    : undefined;

  return {
    vehicleManager: {
      analytics: {
        getSummary: vi.fn().mockReturnValue({
          totalVehicles: 10,
          activeVehicles: 5,
          totalDistanceTraveled: 100,
          avgSpeed: 45,
          totalIdleTime: 300,
          avgRouteEfficiency: 0.9,
          timestamp: Date.now(),
        }),
        getFleetStats: vi.fn().mockReturnValue({
          fleetId: "fleet-1",
          vehicleCount: 3,
          activeCount: 2,
          totalDistance: 50,
          avgSpeed: 40,
          totalIdleTime: 100,
          routeEfficiency: 0.85,
          vehicles: [],
        }),
        resetStats: vi.fn(),
      },
    } as unknown as RouteContext["vehicleManager"],
    stateStore: stateStore as unknown as RouteContext["stateStore"],
    network: {} as RouteContext["network"],
    fleetManager: {} as RouteContext["fleetManager"],
    incidentManager: {} as RouteContext["incidentManager"],
    recordingManager: {} as RouteContext["recordingManager"],
    simulationController: {} as RouteContext["simulationController"],
    scenarioManager: {} as RouteContext["scenarioManager"],
  };
}

function createApp(ctx: RouteContext) {
  const app = express();
  app.use(express.json());
  app.use(createAnalyticsRoutes(ctx));
  return app;
}

describe("Analytics routes", () => {
  describe("GET /analytics/summary", () => {
    it("should return global analytics summary", async () => {
      const ctx = createMockContext();
      const app = createApp(ctx);

      const res = await request(app).get("/analytics/summary");
      expect(res.status).toBe(200);
      expect(res.body.totalVehicles).toBe(10);
      expect(res.body.activeVehicles).toBe(5);
      expect(res.body.avgSpeed).toBe(45);
    });
  });

  describe("GET /analytics/fleet/:id", () => {
    it("should return fleet-specific stats", async () => {
      const ctx = createMockContext();
      const app = createApp(ctx);

      const res = await request(app).get("/analytics/fleet/fleet-1");
      expect(res.status).toBe(200);
      expect(res.body.fleetId).toBe("fleet-1");
      expect(res.body.vehicleCount).toBe(3);
    });
  });

  describe("GET /analytics/history", () => {
    it("should return analytics history when persistence is enabled", async () => {
      const ctx = createMockContext({ withStateStore: true });
      const app = createApp(ctx);

      const res = await request(app).get("/analytics/history");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("should return 503 when persistence is not enabled", async () => {
      const ctx = createMockContext({ withStateStore: false });
      const app = createApp(ctx);

      const res = await request(app).get("/analytics/history");
      expect(res.status).toBe(503);
      expect(res.body.error).toContain("Persistence");
    });

    it("should pass query params to stateStore", async () => {
      const ctx = createMockContext({ withStateStore: true });
      const app = createApp(ctx);

      await request(app).get("/analytics/history?from=2024-01-01&to=2024-12-31&limit=50");

      const stateStore = ctx.stateStore as any;
      expect(stateStore.getAnalyticsHistory).toHaveBeenCalledWith("2024-01-01", "2024-12-31", 50);
    });

    it("should reject invalid limit", async () => {
      const ctx = createMockContext({ withStateStore: true });
      const app = createApp(ctx);

      const res = await request(app).get("/analytics/history?limit=abc");
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("limit");
    });

    it("should reject negative limit", async () => {
      const ctx = createMockContext({ withStateStore: true });
      const app = createApp(ctx);

      const res = await request(app).get("/analytics/history?limit=-5");
      expect(res.status).toBe(400);
    });
  });

  describe("POST /analytics/reset", () => {
    it("should reset all analytics stats", async () => {
      const ctx = createMockContext();
      const app = createApp(ctx);

      const res = await request(app).post("/analytics/reset");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(ctx.vehicleManager.analytics.resetStats).toHaveBeenCalled();
    });
  });
});
