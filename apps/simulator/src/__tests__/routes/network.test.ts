import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createNetworkRoutes } from "../../routes/network";
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
    network: {
      getFeatures: vi.fn().mockReturnValue({ type: "FeatureCollection", features: [] }),
      getAllRoads: vi.fn().mockReturnValue([{ id: "r1", name: "Main Street" }]),
      getAllPOIs: vi.fn().mockReturnValue([{ id: "p1", name: "Hospital" }]),
      generateHeatedZones: vi.fn(),
      exportHeatZones: vi.fn().mockReturnValue([]),
    } as unknown as RouteContext["network"],
    vehicleManager: {} as RouteContext["vehicleManager"],
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
  app.use(createNetworkRoutes(ctx));
  return app;
}

describe("Network routes", () => {
  let ctx: RouteContext;
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    ctx = createMockContext();
    app = createApp(ctx);
  });

  describe("GET /network", () => {
    it("should return network features", async () => {
      const res = await request(app).get("/network");
      expect(res.status).toBe(200);
      expect(res.body.type).toBe("FeatureCollection");
    });

    it("should return 500 if getFeatures throws", async () => {
      (ctx.network.getFeatures as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("boom");
      });
      const res = await request(app).get("/network");
      expect(res.status).toBe(500);
    });
  });

  describe("GET /roads", () => {
    it("should return all roads", async () => {
      const res = await request(app).get("/roads");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe("Main Street");
    });

    it("should return 500 if getAllRoads throws", async () => {
      (ctx.network.getAllRoads as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("boom");
      });
      const res = await request(app).get("/roads");
      expect(res.status).toBe(500);
    });
  });

  describe("GET /pois", () => {
    it("should return all POIs", async () => {
      const res = await request(app).get("/pois");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe("Hospital");
    });

    it("should return 500 if getAllPOIs throws", async () => {
      (ctx.network.getAllPOIs as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("boom");
      });
      const res = await request(app).get("/pois");
      expect(res.status).toBe(500);
    });
  });

  describe("POST /heatzones", () => {
    it("should generate heat zones", async () => {
      const res = await request(app).post("/heatzones");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("heatzones generated");
      expect(ctx.network.generateHeatedZones).toHaveBeenCalledWith(
        expect.objectContaining({ count: 10 })
      );
    });

    it("should return 500 if generation fails", async () => {
      (ctx.network.generateHeatedZones as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("boom");
      });
      const res = await request(app).post("/heatzones");
      expect(res.status).toBe(500);
    });
  });

  describe("GET /heatzones", () => {
    it("should return exported heat zones", async () => {
      const res = await request(app).get("/heatzones");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("should return 500 if export fails", async () => {
      (ctx.network.exportHeatZones as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("boom");
      });
      const res = await request(app).get("/heatzones");
      expect(res.status).toBe(500);
    });
  });
});
