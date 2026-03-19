import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createScenarioRoutes } from "../../routes/scenarios";
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

// Mock fs for scenario file listing and reading
vi.mock("fs", async (importOriginal) => {
  const actual: typeof import("fs") = await importOriginal();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn().mockReturnValue(true),
      readdirSync: vi.fn().mockReturnValue(["rush-hour.json", "quiet-night.json", "readme.txt"]),
      statSync: vi.fn().mockReturnValue({
        size: 2048,
        mtime: new Date("2026-03-18T00:00:00Z"),
      }),
      readFileSync: vi.fn().mockReturnValue(
        JSON.stringify({
          name: "Rush Hour",
          description: "A rush hour scenario",
          duration: 120,
          events: [{ at: 5, action: { type: "spawn_vehicles", count: 3 } }],
        })
      ),
    },
  };
});

const validScenario = {
  name: "Test Scenario",
  description: "A test scenario",
  duration: 120,
  events: [
    { at: 5, action: { type: "spawn_vehicles", count: 3 } },
    { at: 30, action: { type: "clear_incidents" } },
  ],
};

function createMockScenarioManager() {
  return {
    loadScenarioFromJSON: vi.fn().mockReturnValue({
      ...validScenario,
      version: 1,
      events: validScenario.events.map((e) => ({ ...e })),
    }),
    start: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    getStatus: vi.fn().mockReturnValue({
      state: "idle",
      scenario: null,
      elapsed: 0,
      eventIndex: 0,
      eventsExecuted: 0,
      upcomingEvents: [],
    }),
  };
}

function createMockContext(
  scenarioManagerOverrides?: Partial<ReturnType<typeof createMockScenarioManager>>
): RouteContext {
  const scenarioManager = { ...createMockScenarioManager(), ...scenarioManagerOverrides };
  return {
    network: {} as RouteContext["network"],
    vehicleManager: {} as RouteContext["vehicleManager"],
    fleetManager: {} as RouteContext["fleetManager"],
    incidentManager: {} as RouteContext["incidentManager"],
    recordingManager: {} as RouteContext["recordingManager"],
    simulationController: {} as RouteContext["simulationController"],
    scenarioManager: scenarioManager as unknown as RouteContext["scenarioManager"],
  };
}

function createApp(ctx: RouteContext) {
  const app = express();
  app.use(express.json());
  app.use(createScenarioRoutes(ctx));
  return app;
}

describe("Scenario routes", () => {
  let ctx: RouteContext;
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    ctx = createMockContext();
    app = createApp(ctx);
  });

  // ─── GET /scenarios ─────────────────────────────────────────────────

  describe("GET /scenarios", () => {
    it("should list only .json files from scenarios directory", async () => {
      const res = await request(app).get("/scenarios");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].fileName).toBe("rush-hour.json");
      expect(res.body[1].fileName).toBe("quiet-night.json");
      expect(res.body[0].fileSize).toBe(2048);
      expect(res.body[0].modifiedAt).toBe("2026-03-18T00:00:00.000Z");
    });

    it("should return empty array when directory does not exist", async () => {
      const fs = await import("fs");
      (fs.default.existsSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
      const res = await request(app).get("/scenarios");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // ─── POST /scenarios/load ────────────────────────────────────────────

  describe("POST /scenarios/load", () => {
    it("should validate and load a scenario", async () => {
      const res = await request(app).post("/scenarios/load").send(validScenario);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("loaded");
      expect(res.body.scenario.name).toBe("Test Scenario");
      expect(res.body.scenario.duration).toBe(120);
      expect(res.body.scenario.eventCount).toBe(2);
      expect(ctx.scenarioManager.loadScenarioFromJSON).toHaveBeenCalled();
    });

    it("should return 400 for invalid scenario body", async () => {
      const res = await request(app).post("/scenarios/load").send({ name: "" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
      expect(res.body.details).toBeDefined();
    });

    it("should return 400 when required fields are missing", async () => {
      const res = await request(app).post("/scenarios/load").send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    });
  });

  // ─── POST /scenarios/load/:fileName ─────────────────────────────────────

  describe("POST /scenarios/load/:fileName", () => {
    it("should load a scenario file by name and return loaded status", async () => {
      const res = await request(app).post("/scenarios/load/rush-hour.json");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("loaded");
      expect(res.body.scenario.name).toBe("Test Scenario");
      expect(ctx.scenarioManager.loadScenarioFromJSON).toHaveBeenCalled();
    });

    it("should return 404 when scenario file does not exist", async () => {
      const fs = await import("fs");
      (fs.default.existsSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

      const res = await request(app).post("/scenarios/load/nonexistent.json");
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("nonexistent.json");
    });
  });

  // ─── POST /scenarios/start ───────────────────────────────────────────

  describe("POST /scenarios/start", () => {
    it("should start a loaded scenario and return status", async () => {
      (ctx.scenarioManager.getStatus as ReturnType<typeof vi.fn>).mockReturnValue({
        state: "running",
        scenario: { name: "Test Scenario", duration: 120, eventCount: 2 },
        elapsed: 0,
        eventIndex: 0,
        eventsExecuted: 0,
        upcomingEvents: [{ at: 5, type: "spawn_vehicles" }],
      });

      const res = await request(app).post("/scenarios/start");
      expect(res.status).toBe(200);
      expect(res.body.state).toBe("running");
      expect(ctx.scenarioManager.start).toHaveBeenCalled();
    });

    it("should return 409 when no scenario is loaded", async () => {
      (ctx.scenarioManager.start as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("No scenario loaded");
      });

      const res = await request(app).post("/scenarios/start");
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("No scenario loaded");
    });

    it("should return 409 when scenario is already running", async () => {
      (ctx.scenarioManager.start as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Scenario is already running");
      });

      const res = await request(app).post("/scenarios/start");
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Scenario is already running");
    });
  });

  // ─── POST /scenarios/pause ───────────────────────────────────────────

  describe("POST /scenarios/pause", () => {
    it("should pause a running scenario and return status", async () => {
      (ctx.scenarioManager.getStatus as ReturnType<typeof vi.fn>).mockReturnValue({
        state: "paused",
        scenario: { name: "Test Scenario", duration: 120, eventCount: 2 },
        elapsed: 10,
        eventIndex: 1,
        eventsExecuted: 1,
        upcomingEvents: [{ at: 30, type: "clear_incidents" }],
      });

      const res = await request(app).post("/scenarios/pause");
      expect(res.status).toBe(200);
      expect(res.body.state).toBe("paused");
      expect(ctx.scenarioManager.pause).toHaveBeenCalled();
    });

    it("should return 409 when no scenario is running", async () => {
      (ctx.scenarioManager.pause as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("No scenario is running");
      });

      const res = await request(app).post("/scenarios/pause");
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("No scenario is running");
    });
  });

  // ─── POST /scenarios/stop ────────────────────────────────────────────

  describe("POST /scenarios/stop", () => {
    it("should stop a scenario and return status", async () => {
      const res = await request(app).post("/scenarios/stop");
      expect(res.status).toBe(200);
      expect(res.body.state).toBe("idle");
      expect(ctx.scenarioManager.stop).toHaveBeenCalled();
    });

    it("should return 409 when no scenario is running", async () => {
      (ctx.scenarioManager.stop as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("No scenario is running");
      });

      const res = await request(app).post("/scenarios/stop");
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("No scenario is running");
    });
  });

  // ─── GET /scenarios/status ───────────────────────────────────────────

  describe("GET /scenarios/status", () => {
    it("should return idle status when no scenario is loaded", async () => {
      const res = await request(app).get("/scenarios/status");
      expect(res.status).toBe(200);
      expect(res.body.state).toBe("idle");
      expect(res.body.scenario).toBeNull();
      expect(res.body.elapsed).toBe(0);
      expect(res.body.eventIndex).toBe(0);
      expect(res.body.eventsExecuted).toBe(0);
      expect(res.body.upcomingEvents).toEqual([]);
    });

    it("should return running status with scenario details", async () => {
      (ctx.scenarioManager.getStatus as ReturnType<typeof vi.fn>).mockReturnValue({
        state: "running",
        scenario: { name: "Test Scenario", duration: 120, eventCount: 2 },
        elapsed: 15.5,
        eventIndex: 1,
        eventsExecuted: 1,
        upcomingEvents: [{ at: 30, type: "clear_incidents" }],
      });

      const res = await request(app).get("/scenarios/status");
      expect(res.status).toBe(200);
      expect(res.body.state).toBe("running");
      expect(res.body.scenario.name).toBe("Test Scenario");
      expect(res.body.elapsed).toBe(15.5);
      expect(res.body.eventsExecuted).toBe(1);
      expect(res.body.upcomingEvents).toHaveLength(1);
    });
  });
});
