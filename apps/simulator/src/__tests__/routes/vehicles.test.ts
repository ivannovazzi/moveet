import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createVehicleRoutes } from "../../routes/vehicles";
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

function createMockContext(): RouteContext {
  return {
    network: {
      getBoundingBox: vi.fn().mockReturnValue({ minLat: -2, maxLat: 0, minLon: 36, maxLon: 38 }),
      findNearestNode: vi.fn().mockReturnValue({
        id: "node-1",
        coordinates: [-1.3, 36.8],
        connections: [],
      }),
      findNearestRoad: vi.fn().mockResolvedValue({ name: "Main Street", id: "road-1" }),
      searchByName: vi.fn().mockResolvedValue([{ name: "Main Street", id: "road-1" }]),
    } as unknown as RouteContext["network"],
    vehicleManager: {
      getVehicles: vi
        .fn()
        .mockResolvedValue([
          { id: "v1", name: "Car 1", position: [-1.3, 36.8], speed: 40, heading: 90 },
        ]),
      getDirections: vi.fn().mockReturnValue([]),
      hasVehicle: vi.fn().mockReturnValue(true),
    } as unknown as RouteContext["vehicleManager"],
    fleetManager: {} as RouteContext["fleetManager"],
    incidentManager: {} as RouteContext["incidentManager"],
    recordingManager: {} as RouteContext["recordingManager"],
    simulationController: {
      setDirections: vi
        .fn()
        .mockResolvedValue([
          {
            vehicleId: "v1",
            status: "ok",
            route: { start: [0, 0], end: [1, 1], distance: 100 },
            eta: 60,
          },
        ]),
    } as unknown as RouteContext["simulationController"],
  };
}

function createApp(ctx: RouteContext) {
  const app = express();
  app.use(express.json());
  app.use(createVehicleRoutes(ctx));
  return app;
}

describe("Vehicle routes", () => {
  let ctx: RouteContext;
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    ctx = createMockContext();
    app = createApp(ctx);
  });

  describe("GET /vehicle-types", () => {
    it("should return vehicle profiles", async () => {
      const res = await request(app).get("/vehicle-types");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("car");
      expect(res.body).toHaveProperty("truck");
      expect(res.body).toHaveProperty("motorcycle");
      expect(res.body).toHaveProperty("ambulance");
      expect(res.body).toHaveProperty("bus");
    });
  });

  describe("GET /vehicles", () => {
    it("should return vehicles list", async () => {
      const res = await request(app).get("/vehicles");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe("v1");
    });
  });

  describe("GET /directions", () => {
    it("should return directions", async () => {
      const res = await request(app).get("/directions");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("should return 500 if getDirections throws", async () => {
      (ctx.vehicleManager.getDirections as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("boom");
      });
      const res = await request(app).get("/directions");
      expect(res.status).toBe(500);
    });
  });

  describe("POST /direction", () => {
    it("should dispatch directions", async () => {
      const res = await request(app)
        .post("/direction")
        .send([{ id: "v1", lat: -1.3, lng: 36.8 }]);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("direction");
      expect(res.body.results).toHaveLength(1);
    });

    it("should reject non-array body", async () => {
      const res = await request(app).post("/direction").send({ id: "v1", lat: -1.3, lng: 36.8 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    });

    it("should reject empty array", async () => {
      const res = await request(app).post("/direction").send([]);
      expect(res.status).toBe(400);
    });

    it("should validate vehicle id exists", async () => {
      (ctx.vehicleManager.hasVehicle as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const res = await request(app)
        .post("/direction")
        .send([{ id: "ghost", lat: -1.3, lng: 36.8 }]);
      expect(res.status).toBe(400);
      expect(res.body.details[0]).toContain("not found");
    });

    it("should validate coordinates are numbers", async () => {
      const res = await request(app)
        .post("/direction")
        .send([{ id: "v1", lat: "bad", lng: 36.8 }]);
      expect(res.status).toBe(400);
      expect(res.body.details[0]).toContain("lat");
    });

    it("should reject coordinates outside bounding box", async () => {
      const res = await request(app)
        .post("/direction")
        .send([{ id: "v1", lat: 50, lng: 100 }]);
      expect(res.status).toBe(400);
      expect(res.body.details[0]).toContain("outside");
    });

    it("should validate waypoints when provided", async () => {
      const res = await request(app)
        .post("/direction")
        .send([{ id: "v1", waypoints: [{ lat: "bad", lng: 36.8 }] }]);
      expect(res.status).toBe(400);
      expect(res.body.details[0]).toContain("waypoints");
    });

    it("should validate missing id field", async () => {
      const res = await request(app)
        .post("/direction")
        .send([{ lat: -1.3, lng: 36.8 }]);
      expect(res.status).toBe(400);
      expect(res.body.details[0]).toContain("id");
    });
  });

  describe("POST /find-node", () => {
    it("should return nearest node coordinates", async () => {
      const res = await request(app).post("/find-node").send([36.8, -1.3]);
      expect(res.status).toBe(200);
      // Returns [lng, lat] format
      expect(res.body).toHaveLength(2);
    });

    it("should reject invalid coordinates", async () => {
      const res = await request(app).post("/find-node").send({ foo: "bar" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    });
  });

  describe("POST /find-road", () => {
    it("should return nearest road", async () => {
      const res = await request(app).post("/find-road").send([36.8, -1.3]);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Main Street");
    });

    it("should reject invalid coordinates", async () => {
      const res = await request(app).post("/find-road").send("not-coords");
      expect(res.status).toBe(400);
    });
  });

  describe("POST /search", () => {
    it("should return search results", async () => {
      const res = await request(app).post("/search").send({ query: "Main" });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it("should reject missing query", async () => {
      const res = await request(app).post("/search").send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
      expect(res.body.details.some((d: string) => d.includes("query"))).toBe(true);
    });
  });
});
