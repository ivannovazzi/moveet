import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createReplayRoutes } from "../../routes/replay";
import type { RouteContext } from "../../routes/types";

// Mock logger to suppress output
vi.mock("../../utils/logger", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock rate limiter to be a passthrough
vi.mock("../../middleware/rateLimiter", () => ({
  generalRateLimiter: { middleware: () => (_req: unknown, _res: unknown, next: () => void) => next(), cleanup: vi.fn() },
  expensiveRateLimiter: { middleware: () => (_req: unknown, _res: unknown, next: () => void) => next(), cleanup: vi.fn() },
}));

function createMockContext(): RouteContext {
  return {
    network: {} as RouteContext["network"],
    vehicleManager: {} as RouteContext["vehicleManager"],
    fleetManager: {} as RouteContext["fleetManager"],
    incidentManager: {} as RouteContext["incidentManager"],
    recordingManager: {} as RouteContext["recordingManager"],
    simulationController: {
      startReplay: vi.fn().mockResolvedValue({
        format: "moveet-recording",
        version: 1,
        startTime: "2026-03-16T00:00:00.000Z",
        vehicleCount: 5,
        options: {},
      }),
      pauseReplay: vi.fn(),
      resumeReplay: vi.fn(),
      stopReplay: vi.fn(),
      seekReplay: vi.fn(),
      setReplaySpeed: vi.fn(),
      getReplayStatus: vi.fn().mockReturnValue({
        mode: "live",
      }),
    } as unknown as RouteContext["simulationController"],
  };
}

function createApp(ctx: RouteContext) {
  const app = express();
  app.use(express.json());
  app.use(createReplayRoutes(ctx));
  return app;
}

describe("Replay routes", () => {
  let ctx: RouteContext;
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    ctx = createMockContext();
    app = createApp(ctx);
  });

  describe("POST /replay/start", () => {
    it("should start replay with valid file", async () => {
      const res = await request(app).post("/replay/start").send({ file: "test.ndjson", speed: 2 });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("replaying");
      expect(res.body.header).toBeDefined();
      expect(ctx.simulationController.startReplay).toHaveBeenCalledWith(
        "recordings/test.ndjson",
        2
      );
    });

    it("should reject missing file parameter", async () => {
      const res = await request(app).post("/replay/start").send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("file is required");
    });

    it("should return 400 if startReplay throws", async () => {
      (ctx.simulationController.startReplay as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("File not found")
      );
      const res = await request(app).post("/replay/start").send({ file: "missing.ndjson" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("File not found");
    });
  });

  describe("POST /replay/pause", () => {
    it("should pause replay", async () => {
      const res = await request(app).post("/replay/pause");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("paused");
      expect(ctx.simulationController.pauseReplay).toHaveBeenCalled();
    });
  });

  describe("POST /replay/resume", () => {
    it("should resume replay", async () => {
      const res = await request(app).post("/replay/resume");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("resumed");
      expect(ctx.simulationController.resumeReplay).toHaveBeenCalled();
    });
  });

  describe("POST /replay/stop", () => {
    it("should stop replay", async () => {
      const res = await request(app).post("/replay/stop");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("stopped");
      expect(ctx.simulationController.stopReplay).toHaveBeenCalled();
    });
  });

  describe("POST /replay/seek", () => {
    it("should seek to timestamp", async () => {
      const res = await request(app).post("/replay/seek").send({ timestamp: 30000 });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("seeked");
      expect(res.body.timestamp).toBe(30000);
      expect(ctx.simulationController.seekReplay).toHaveBeenCalledWith(30000);
    });
  });

  describe("POST /replay/speed", () => {
    it("should change replay speed", async () => {
      const res = await request(app).post("/replay/speed").send({ speed: 4 });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("speed_changed");
      expect(res.body.speed).toBe(4);
      expect(ctx.simulationController.setReplaySpeed).toHaveBeenCalledWith(4);
    });

    it("should default to speed 1 if not provided", async () => {
      const res = await request(app).post("/replay/speed").send({});
      expect(res.status).toBe(200);
      expect(ctx.simulationController.setReplaySpeed).toHaveBeenCalledWith(1);
    });
  });

  describe("GET /replay/status", () => {
    it("should return replay status", async () => {
      const res = await request(app).get("/replay/status");
      expect(res.status).toBe(200);
      expect(res.body.mode).toBe("live");
    });

    it("should return 500 if getReplayStatus throws", async () => {
      (ctx.simulationController.getReplayStatus as ReturnType<typeof vi.fn>).mockImplementation(
        () => {
          throw new Error("boom");
        }
      );
      const res = await request(app).get("/replay/status");
      expect(res.status).toBe(500);
    });
  });
});
