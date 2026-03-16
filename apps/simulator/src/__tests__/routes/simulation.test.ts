import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createSimulationRoutes } from "../../routes/simulation";
import type { RouteContext } from "../../routes/types";

// Mock logger to suppress output
vi.mock("../../utils/logger", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function createMockContext(): RouteContext {
  return {
    network: {} as RouteContext["network"],
    vehicleManager: {
      getOptions: vi.fn().mockReturnValue({ minSpeed: 20, maxSpeed: 60 }),
      getTrafficSnapshot: vi.fn().mockReturnValue({ edges: {} }),
    } as unknown as RouteContext["vehicleManager"],
    fleetManager: {} as RouteContext["fleetManager"],
    incidentManager: {} as RouteContext["incidentManager"],
    recordingManager: {} as RouteContext["recordingManager"],
    simulationController: {
      getStatus: vi.fn().mockReturnValue({ running: false, ready: true, interval: 500 }),
      reset: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      setOptions: vi.fn().mockResolvedValue(undefined),
      getClock: vi.fn().mockReturnValue({
        getState: vi.fn().mockReturnValue({
          currentTime: "2026-03-16T00:00:00.000Z",
          speedMultiplier: 1,
          hour: 0,
          timeOfDay: "night",
        }),
        setSpeedMultiplier: vi.fn(),
        setTime: vi.fn(),
      }),
      getTrafficProfile: vi.fn().mockReturnValue({ name: "default", timeRanges: [] }),
      setTrafficProfile: vi.fn(),
    } as unknown as RouteContext["simulationController"],
  };
}

function createApp(ctx: RouteContext) {
  const app = express();
  app.use(express.json());
  app.use(createSimulationRoutes(ctx));
  return app;
}

describe("Simulation routes", () => {
  let ctx: RouteContext;
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    ctx = createMockContext();
    app = createApp(ctx);
  });

  describe("GET /status", () => {
    it("should return simulation status", async () => {
      const res = await request(app).get("/status");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ running: false, ready: true, interval: 500 });
    });

    it("should return 500 if getStatus throws", async () => {
      (ctx.simulationController.getStatus as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("boom");
      });
      const res = await request(app).get("/status");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to get status");
    });
  });

  describe("POST /reset", () => {
    it("should reset simulation", async () => {
      const res = await request(app).post("/reset");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "reset" });
      expect(ctx.simulationController.reset).toHaveBeenCalled();
    });
  });

  describe("POST /start", () => {
    it("should start simulation with body", async () => {
      const res = await request(app).post("/start").send({ vehicleTypes: { car: 5 } });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("started");
      expect(res.body.vehicleTypes).toEqual({ car: 5 });
      expect(ctx.simulationController.start).toHaveBeenCalledWith({ vehicleTypes: { car: 5 } });
    });

    it("should return null vehicleTypes if not provided", async () => {
      const res = await request(app).post("/start").send({});
      expect(res.status).toBe(200);
      expect(res.body.vehicleTypes).toBe(null);
    });
  });

  describe("POST /stop", () => {
    it("should stop simulation", async () => {
      const res = await request(app).post("/stop");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "stopped" });
      expect(ctx.simulationController.stop).toHaveBeenCalled();
    });

    it("should return 500 if stop throws", async () => {
      (ctx.simulationController.stop as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("boom");
      });
      const res = await request(app).post("/stop");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to stop simulation");
    });
  });

  describe("GET /options", () => {
    it("should return current options", async () => {
      const res = await request(app).get("/options");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ minSpeed: 20, maxSpeed: 60 });
    });
  });

  describe("POST /options", () => {
    it("should set options", async () => {
      const newOptions = { minSpeed: 10, maxSpeed: 80 };
      const res = await request(app).post("/options").send(newOptions);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "options set" });
      expect(ctx.simulationController.setOptions).toHaveBeenCalledWith(newOptions);
    });
  });

  describe("GET /clock", () => {
    it("should return clock state", async () => {
      const res = await request(app).get("/clock");
      expect(res.status).toBe(200);
      expect(res.body.speedMultiplier).toBe(1);
      expect(res.body.timeOfDay).toBe("night");
    });
  });

  describe("POST /clock", () => {
    it("should set speed multiplier", async () => {
      const res = await request(app).post("/clock").send({ speedMultiplier: 2 });
      expect(res.status).toBe(200);
      const clock = ctx.simulationController.getClock();
      expect(clock.setSpeedMultiplier).toHaveBeenCalledWith(2);
    });

    it("should reject negative speed multiplier", async () => {
      const res = await request(app).post("/clock").send({ speedMultiplier: -1 });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("non-negative");
    });

    it("should set time with valid ISO string", async () => {
      const res = await request(app).post("/clock").send({ setTime: "2026-03-16T12:00:00Z" });
      expect(res.status).toBe(200);
      const clock = ctx.simulationController.getClock();
      expect(clock.setTime).toHaveBeenCalled();
    });

    it("should reject invalid date string", async () => {
      const res = await request(app).post("/clock").send({ setTime: "not-a-date" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("valid ISO date");
    });
  });

  describe("GET /traffic", () => {
    it("should return traffic snapshot", async () => {
      const res = await request(app).get("/traffic");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ edges: {} });
    });
  });

  describe("GET /traffic-profile", () => {
    it("should return traffic profile", async () => {
      const res = await request(app).get("/traffic-profile");
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("default");
    });
  });

  describe("POST /traffic-profile", () => {
    it("should set traffic profile with valid body", async () => {
      const profile = { name: "rush", timeRanges: [{ start: 7, end: 9 }] };
      const res = await request(app).post("/traffic-profile").send(profile);
      expect(res.status).toBe(200);
      expect(ctx.simulationController.setTrafficProfile).toHaveBeenCalled();
    });

    it("should reject invalid traffic profile", async () => {
      const res = await request(app).post("/traffic-profile").send({ name: 42 });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid traffic profile");
    });

    it("should reject missing timeRanges", async () => {
      const res = await request(app).post("/traffic-profile").send({ name: "test" });
      expect(res.status).toBe(400);
    });
  });
});
