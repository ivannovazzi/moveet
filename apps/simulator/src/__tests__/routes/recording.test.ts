import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createRecordingRoutes } from "../../routes/recording";
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

// Mock fs for recordings list
vi.mock("fs", async (importOriginal) => {
  const actual: typeof import("fs") = await importOriginal();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn().mockReturnValue(true),
      readdirSync: vi.fn().mockReturnValue(["recording-1.ndjson"]),
      statSync: vi.fn().mockReturnValue({
        size: 1024,
        mtime: new Date("2026-03-16T00:00:00Z"),
      }),
    },
  };
});

function createMockContext(): RouteContext {
  return {
    network: {} as RouteContext["network"],
    vehicleManager: {} as RouteContext["vehicleManager"],
    fleetManager: {} as RouteContext["fleetManager"],
    incidentManager: {} as RouteContext["incidentManager"],
    recordingManager: {
      isRecording: vi.fn().mockReturnValue(false),
      startRecording: vi.fn().mockReturnValue("recordings/test.ndjson"),
      stopRecording: vi.fn().mockReturnValue({
        filePath: "recordings/test.ndjson",
        startTime: "2026-03-16T00:00:00.000Z",
        duration: 60000,
        eventCount: 100,
        fileSize: 1024,
        vehicleCount: 5,
      }),
    } as unknown as RouteContext["recordingManager"],
    simulationController: {
      getOptions: vi.fn().mockReturnValue({ minSpeed: 20, maxSpeed: 60 }),
      getVehicles: vi.fn().mockReturnValue([{ id: "v1" }, { id: "v2" }]),
    } as unknown as RouteContext["simulationController"],
  };
}

function createApp(ctx: RouteContext) {
  const app = express();
  app.use(express.json());
  app.use(createRecordingRoutes(ctx));
  return app;
}

describe("Recording routes", () => {
  let ctx: RouteContext;
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    ctx = createMockContext();
    app = createApp(ctx);
  });

  describe("POST /recording/start", () => {
    it("should start a recording", async () => {
      const res = await request(app).post("/recording/start");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("recording");
      expect(res.body.filePath).toBe("recordings/test.ndjson");
      expect(ctx.recordingManager.startRecording).toHaveBeenCalled();
    });

    it("should return 409 if already recording", async () => {
      (ctx.recordingManager.isRecording as ReturnType<typeof vi.fn>).mockReturnValue(true);
      const res = await request(app).post("/recording/start");
      expect(res.status).toBe(409);
      expect(res.body.error).toContain("already in progress");
    });
  });

  describe("POST /recording/stop", () => {
    it("should stop a recording", async () => {
      (ctx.recordingManager.isRecording as ReturnType<typeof vi.fn>).mockReturnValue(true);
      const res = await request(app).post("/recording/stop");
      expect(res.status).toBe(200);
      expect(res.body.filePath).toBe("recordings/test.ndjson");
    });

    it("should return 409 if not recording", async () => {
      const res = await request(app).post("/recording/stop");
      expect(res.status).toBe(409);
      expect(res.body.error).toContain("No recording");
    });
  });

  describe("GET /recordings", () => {
    it("should list recordings", async () => {
      const res = await request(app).get("/recordings");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].fileName).toBe("recording-1.ndjson");
      expect(res.body[0].fileSize).toBe(1024);
    });
  });
});
