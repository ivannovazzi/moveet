import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { Readable } from "stream";
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
  generalRateLimiter: {
    middleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    cleanup: vi.fn(),
  },
  expensiveRateLimiter: {
    middleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    cleanup: vi.fn(),
  },
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
      unlinkSync: vi.fn(),
      createReadStream: vi.fn(() =>
        Readable.from([
          '{"format":"moveet-recording","version":1,"startTime":"2026-05-25T00:00:00.000Z","vehicleCount":3,"options":{},"generated":true,"stepMs":1000}\n',
          '{"timestamp":1000,"type":"vehicle","data":{"vehicles":[]}}\n',
        ])
      ),
    },
  };
});

function createMockContext(withStateStore = false): RouteContext {
  const ctx: RouteContext = {
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
    scenarioManager: {} as RouteContext["scenarioManager"],
    generationManager: {
      isRunning: vi.fn().mockReturnValue(false),
      start: vi.fn().mockReturnValue("job-123"),
      getStatus: vi.fn().mockReturnValue({ state: "idle" }),
    } as unknown as RouteContext["generationManager"],
  };

  if (withStateStore) {
    ctx.stateStore = {
      getRecordings: vi.fn().mockReturnValue([
        {
          id: 1,
          file_path: "recordings/test.ndjson",
          duration: 60000,
          event_count: 100,
          file_size: 1024,
          vehicle_count: 5,
          start_time: "2026-03-16T00:00:00.000Z",
          created_at: "2026-03-16 00:01:00",
        },
      ]),
      getRecording: vi.fn().mockImplementation((id: number) => {
        if (id === 1) {
          return {
            id: 1,
            file_path: "recordings/test.ndjson",
            duration: 60000,
            event_count: 100,
            file_size: 1024,
            vehicle_count: 5,
            start_time: "2026-03-16T00:00:00.000Z",
            created_at: "2026-03-16 00:01:00",
          };
        }
        return undefined;
      }),
      deleteRecording: vi.fn().mockImplementation((id: number) => {
        if (id === 1) return "recordings/test.ndjson";
        return undefined;
      }),
    } as unknown as RouteContext["stateStore"];
  }

  return ctx;
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
    it("should list recordings from filesystem when no stateStore", async () => {
      const res = await request(app).get("/recordings");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].fileName).toBe("recording-1.ndjson");
      expect(res.body[0].fileSize).toBe(1024);
    });

    it("should list recordings from stateStore when available", async () => {
      ctx = createMockContext(true);
      app = createApp(ctx);

      const res = await request(app).get("/recordings");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(1);
      expect(res.body[0].filePath).toBe("recordings/test.ndjson");
      expect(res.body[0].duration).toBe(60000);
      expect(res.body[0].eventCount).toBe(100);
      expect(res.body[0].vehicleCount).toBe(5);
      expect(ctx.stateStore!.getRecordings).toHaveBeenCalled();
    });
  });

  // ─── New endpoints ──────────────────────────────────────────────────

  describe("GET /recordings/:id", () => {
    it("should return 501 when persistence is not enabled", async () => {
      const res = await request(app).get("/recordings/1");
      expect(res.status).toBe(501);
      expect(res.body.error).toContain("Persistence not enabled");
    });

    it("should return a single recording", async () => {
      ctx = createMockContext(true);
      app = createApp(ctx);

      const res = await request(app).get("/recordings/1");
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(1);
      expect(res.body.filePath).toBe("recordings/test.ndjson");
    });

    it("should return 404 for non-existent recording", async () => {
      ctx = createMockContext(true);
      app = createApp(ctx);

      const res = await request(app).get("/recordings/999");
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("not found");
    });

    it("should return 400 for invalid id", async () => {
      ctx = createMockContext(true);
      app = createApp(ctx);

      const res = await request(app).get("/recordings/abc");
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid recording id");
    });
  });

  describe("DELETE /recordings/:id", () => {
    it("should return 501 when persistence is not enabled", async () => {
      const res = await request(app).delete("/recordings/1");
      expect(res.status).toBe(501);
      expect(res.body.error).toContain("Persistence not enabled");
    });

    it("should delete a recording", async () => {
      ctx = createMockContext(true);
      app = createApp(ctx);

      const res = await request(app).delete("/recordings/1");
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(true);
      expect(res.body.id).toBe(1);
      expect(res.body.filePath).toBe("recordings/test.ndjson");
      expect(ctx.stateStore!.deleteRecording).toHaveBeenCalledWith(1);
    });

    it("should return 404 for non-existent recording", async () => {
      ctx = createMockContext(true);
      app = createApp(ctx);

      const res = await request(app).delete("/recordings/999");
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("not found");
    });

    it("should return 400 for invalid id", async () => {
      ctx = createMockContext(true);
      app = createApp(ctx);

      const res = await request(app).delete("/recordings/abc");
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid recording id");
    });
  });

  // ─── Generation ─────────────────────────────────────────────────────

  describe("POST /recording/generate", () => {
    const validBody = {
      startTime: "2026-05-25T00:00:00.000Z",
      steps: 5,
      vehicleCount: 3,
      stepMs: 1000,
      seed: 1,
    };

    it("should return 202 with a jobId and call generationManager.start", async () => {
      const res = await request(app).post("/recording/generate").send(validBody);
      expect(res.status).toBe(202);
      expect(res.body.status).toBe("generating");
      expect(res.body.jobId).toBe("job-123");
      expect(ctx.generationManager.start).toHaveBeenCalledWith(
        expect.objectContaining({ vehicleCount: 3, stepMs: 1000, steps: 5 })
      );
    });

    it("should return 409 when a job is already running", async () => {
      (ctx.generationManager.isRunning as ReturnType<typeof vi.fn>).mockReturnValue(true);
      const res = await request(app).post("/recording/generate").send(validBody);
      expect(res.status).toBe(409);
      expect(res.body.error).toContain("already running");
    });

    it("should return 400 for an invalid startTime", async () => {
      const res = await request(app)
        .post("/recording/generate")
        .send({ ...validBody, startTime: "not-a-date" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("startTime");
    });

    it("should return 400 when neither hours nor steps is provided", async () => {
      const { steps: _omit, ...body } = validBody;
      const res = await request(app).post("/recording/generate").send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("hours or steps");
    });

    it("should return 400 for a non-positive vehicleCount", async () => {
      const res = await request(app)
        .post("/recording/generate")
        .send({ ...validBody, vehicleCount: 0 });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("vehicleCount");
    });
  });

  describe("GET /recording/generate/status", () => {
    it("should report the generation manager status", async () => {
      (ctx.generationManager.getStatus as ReturnType<typeof vi.fn>).mockReturnValue({
        state: "running",
        jobId: "job-123",
        step: 2,
        totalSteps: 5,
        pct: 40,
      });
      const res = await request(app).get("/recording/generate/status");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        state: "running",
        jobId: "job-123",
        step: 2,
        totalSteps: 5,
        pct: 40,
      });
    });
  });

  // ─── Download ───────────────────────────────────────────────────────

  describe("GET /recordings/:id/download", () => {
    it("should return 501 when persistence is not enabled", async () => {
      const res = await request(app).get("/recordings/1/download");
      expect(res.status).toBe(501);
    });

    it("should stream NDJSON with the correct content type", async () => {
      ctx = createMockContext(true);
      app = createApp(ctx);

      const res = await request(app).get("/recordings/1/download");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/x-ndjson");
      // First line is the back-dated generated header.
      const firstLine = res.text.trim().split("\n")[0];
      const header = JSON.parse(firstLine);
      expect(header.format).toBe("moveet-recording");
      expect(header.generated).toBe(true);
      expect(header.startTime).toBe("2026-05-25T00:00:00.000Z");
    });

    it("should return 404 for a non-existent recording", async () => {
      ctx = createMockContext(true);
      app = createApp(ctx);

      const res = await request(app).get("/recordings/999/download");
      expect(res.status).toBe(404);
    });

    it("should return 400 for an invalid id", async () => {
      ctx = createMockContext(true);
      app = createApp(ctx);

      const res = await request(app).get("/recordings/abc/download");
      expect(res.status).toBe(400);
    });
  });
});
