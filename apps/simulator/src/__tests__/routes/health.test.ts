import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock logger to suppress output
vi.mock("../../utils/logger", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function createApp(overrides?: {
  network?: unknown;
  simulationController?: { getStatus: () => { ready: boolean } };
  vehicleManager?: { adapterSync: { isConnected: () => boolean } };
}) {
  const app = express();
  const startTime = Date.now();

  const network = overrides?.network ?? {};
  const simulationController = overrides?.simulationController ?? {
    getStatus: vi.fn().mockReturnValue({ ready: true }),
  };
  const vehicleManager = overrides?.vehicleManager ?? {
    adapterSync: { isConnected: vi.fn().mockReturnValue(true) },
  };

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      uptime: Math.floor((Date.now() - startTime) / 1000),
      subsystems: {
        roadNetwork: !!network,
        simulation: simulationController.getStatus().ready,
      },
      adapterConnected: vehicleManager.adapterSync.isConnected(),
    });
  });

  return app;
}

describe("GET /health", () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    app = createApp();
  });

  it("should return 200 with ok status", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("should include uptime as a number", async () => {
    const res = await request(app).get("/health");
    expect(typeof res.body.uptime).toBe("number");
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("should report subsystems", async () => {
    const res = await request(app).get("/health");
    expect(res.body.subsystems).toEqual({
      roadNetwork: true,
      simulation: true,
    });
  });

  it("should report simulation not ready when controller says so", async () => {
    app = createApp({
      simulationController: {
        getStatus: () => ({ ready: false }),
      },
    });
    const res = await request(app).get("/health");
    expect(res.body.subsystems.simulation).toBe(false);
  });

  it("should report adapterConnected true when adapter sync is healthy or disabled", async () => {
    const res = await request(app).get("/health");
    expect(res.body.adapterConnected).toBe(true);
  });

  it("should report adapterConnected false when the most recent adapter sync failed", async () => {
    app = createApp({
      vehicleManager: {
        adapterSync: { isConnected: () => false },
      },
    });
    const res = await request(app).get("/health");
    expect(res.body.adapterConnected).toBe(false);
  });
});
