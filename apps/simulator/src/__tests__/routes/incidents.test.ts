import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createIncidentRoutes } from "../../routes/incidents";
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

const mockIncidentDTO = {
  id: "inc-1",
  edgeIds: ["e1"],
  type: "accident",
  severity: 0.5,
  speedFactor: 0.2,
  startTime: Date.now(),
  duration: 60000,
  expiresAt: Date.now() + 60000,
  autoClears: true,
  position: [-1.3, 36.8] as [number, number],
};

function createMockContext(): RouteContext {
  return {
    network: {
      getEdge: vi.fn().mockReturnValue({
        id: "e1",
        start: { coordinates: [-1.3, 36.8] },
        end: { coordinates: [-1.31, 36.81] },
      }),
      getRandomEdge: vi.fn().mockReturnValue({
        id: "e1",
        start: { coordinates: [-1.3, 36.8] },
        end: { coordinates: [-1.31, 36.81] },
      }),
      findNearestNode: vi.fn().mockReturnValue({
        id: "node-1",
        coordinates: [-1.3, 36.8],
        connections: [
          {
            id: "e1",
            start: { coordinates: [-1.3, 36.8] },
            end: { coordinates: [-1.31, 36.81] },
          },
        ],
      }),
    } as unknown as RouteContext["network"],
    vehicleManager: {} as RouteContext["vehicleManager"],
    fleetManager: {} as RouteContext["fleetManager"],
    incidentManager: {
      getActiveIncidents: vi.fn().mockReturnValue([{ id: "inc-1" }]),
      toDTO: vi.fn().mockReturnValue(mockIncidentDTO),
      createIncident: vi.fn().mockReturnValue({ id: "inc-1" }),
      removeIncident: vi.fn().mockReturnValue(true),
    } as unknown as RouteContext["incidentManager"],
    recordingManager: {} as RouteContext["recordingManager"],
    simulationController: {} as RouteContext["simulationController"],
  };
}

function createApp(ctx: RouteContext) {
  const app = express();
  app.use(express.json());
  app.use(createIncidentRoutes(ctx));
  return app;
}

describe("Incident routes", () => {
  let ctx: RouteContext;
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    ctx = createMockContext();
    app = createApp(ctx);
  });

  describe("GET /incidents", () => {
    it("should return active incidents", async () => {
      const res = await request(app).get("/incidents");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].type).toBe("accident");
    });

    it("should return 500 if getActiveIncidents throws", async () => {
      (ctx.incidentManager.getActiveIncidents as ReturnType<typeof vi.fn>).mockImplementation(
        () => {
          throw new Error("boom");
        }
      );
      const res = await request(app).get("/incidents");
      expect(res.status).toBe(500);
    });
  });

  describe("POST /incidents", () => {
    it("should create an incident with valid data", async () => {
      const res = await request(app)
        .post("/incidents")
        .send({
          edgeIds: ["e1"],
          type: "accident",
          duration: 60000,
          severity: 0.5,
        });
      expect(res.status).toBe(201);
      expect(ctx.incidentManager.createIncident).toHaveBeenCalled();
    });

    it("should reject missing edgeIds", async () => {
      const res = await request(app).post("/incidents").send({
        type: "accident",
        duration: 60000,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
      expect(res.body.details.some((d: string) => d.includes("edgeIds"))).toBe(true);
    });

    it("should reject invalid type", async () => {
      const res = await request(app)
        .post("/incidents")
        .send({
          edgeIds: ["e1"],
          type: "invalid",
          duration: 60000,
        });
      expect(res.status).toBe(400);
      expect(res.body.details.some((d: string) => d.includes("type must be one of"))).toBe(true);
    });

    it("should reject invalid duration", async () => {
      const res = await request(app)
        .post("/incidents")
        .send({
          edgeIds: ["e1"],
          type: "accident",
          duration: -1,
        });
      expect(res.status).toBe(400);
      expect(res.body.details.some((d: string) => d.includes("duration"))).toBe(true);
    });

    it("should reject severity out of range", async () => {
      const res = await request(app)
        .post("/incidents")
        .send({
          edgeIds: ["e1"],
          type: "accident",
          duration: 60000,
          severity: 1.5,
        });
      expect(res.status).toBe(400);
      expect(res.body.details.some((d: string) => d.includes("severity"))).toBe(true);
    });

    it("should accept missing severity (optional)", async () => {
      const res = await request(app)
        .post("/incidents")
        .send({
          edgeIds: ["e1"],
          type: "accident",
          duration: 60000,
        });
      expect(res.status).toBe(201);
    });
  });

  describe("DELETE /incidents/:id", () => {
    it("should remove an incident", async () => {
      const res = await request(app).delete("/incidents/inc-1");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "removed" });
    });

    it("should return 404 for non-existent incident", async () => {
      (ctx.incidentManager.removeIncident as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const res = await request(app).delete("/incidents/non-existent");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /incidents/random", () => {
    it("should create a random incident", async () => {
      const res = await request(app).post("/incidents/random");
      expect(res.status).toBe(201);
      expect(ctx.incidentManager.createIncident).toHaveBeenCalled();
    });
  });

  describe("POST /incidents/at-position", () => {
    it("should create an incident at given position", async () => {
      const res = await request(app).post("/incidents/at-position").send({
        lat: -1.3,
        lng: 36.8,
        type: "construction",
      });
      expect(res.status).toBe(201);
    });

    it("should reject missing lat/lng", async () => {
      const res = await request(app).post("/incidents/at-position").send({
        type: "accident",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
      expect(res.body.details.some((d: string) => d.includes("lat") || d.includes("lng"))).toBe(
        true
      );
    });

    it("should reject invalid type", async () => {
      const res = await request(app).post("/incidents/at-position").send({
        lat: -1.3,
        lng: 36.8,
        type: "invalid",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
      expect(res.body.details.some((d: string) => d.includes("type must be one of"))).toBe(true);
    });

    it("should return 400 if no road near position", async () => {
      (ctx.network.findNearestNode as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "node-1",
        coordinates: [-1.3, 36.8],
        connections: [],
      });
      const res = await request(app).post("/incidents/at-position").send({
        lat: -1.3,
        lng: 36.8,
        type: "accident",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("No road found");
    });
  });
});
