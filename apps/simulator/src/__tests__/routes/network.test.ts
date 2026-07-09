import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createNetworkRoutes } from "../../routes/network";
import { HeatZoneCapError } from "../../modules/HeatZoneManager";
import { HEAT_ZONE_DEFAULTS } from "../../constants";
import type { RouteContext } from "../../routes/types";

// Mock logger to suppress output
vi.mock("../../utils/logger", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const sampleFeature = {
  type: "Feature",
  properties: {
    id: "hz-1",
    intensity: 0.6,
    timestamp: "2026-07-09T00:00:00.000Z",
    radius: 0.5,
  },
  geometry: {
    type: "Polygon",
    coordinates: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  },
};

const validGeometry = {
  type: "Polygon",
  coordinates: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 0],
  ],
};

function createMockContext(): RouteContext {
  return {
    network: {
      getFeatures: vi.fn().mockReturnValue({ type: "FeatureCollection", features: [] }),
      getAllRoads: vi.fn().mockReturnValue([{ id: "r1", name: "Main Street" }]),
      getAllPOIs: vi.fn().mockReturnValue([{ id: "p1", name: "Hospital" }]),
      getSpeedLimits: vi.fn().mockReturnValue([]),
      exportHeatZones: vi.fn().mockReturnValue([]),
      addHeatZone: vi.fn().mockReturnValue(sampleFeature),
      updateHeatZone: vi.fn().mockReturnValue(sampleFeature),
      removeHeatZone: vi.fn().mockReturnValue(true),
      clearHeatZones: vi.fn(),
      seedHeatZones: vi.fn().mockReturnValue([sampleFeature]),
    } as unknown as RouteContext["network"],
    vehicleManager: {} as RouteContext["vehicleManager"],
    fleetManager: {} as RouteContext["fleetManager"],
    incidentManager: {} as RouteContext["incidentManager"],
    recordingManager: {} as RouteContext["recordingManager"],
    simulationController: {} as RouteContext["simulationController"],
    scenarioManager: {} as RouteContext["scenarioManager"],

    generationManager: {} as RouteContext["generationManager"],
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

  describe("POST /heatzones", () => {
    it("creates a zone from valid geometry and returns 201 with the feature", async () => {
      const res = await request(app)
        .post("/heatzones")
        .send({ geometry: validGeometry, intensity: 0.7 });
      expect(res.status).toBe(201);
      expect(res.body.properties.id).toBe("hz-1");
      expect(ctx.network.addHeatZone).toHaveBeenCalledWith(
        expect.objectContaining({
          polygon: validGeometry.coordinates,
          intensity: 0.7,
        })
      );
    });

    it("defaults intensity to the server-side default when omitted", async () => {
      const res = await request(app).post("/heatzones").send({ geometry: validGeometry });
      expect(res.status).toBe(201);
      expect(ctx.network.addHeatZone).toHaveBeenCalledWith(
        expect.objectContaining({
          intensity: HEAT_ZONE_DEFAULTS.DEFAULT_INTENSITY,
        })
      );
    });

    it("rejects a coordinate outside WGS84 range (400) without indexing", async () => {
      const res = await request(app)
        .post("/heatzones")
        .send({
          geometry: {
            type: "Polygon",
            coordinates: [
              [4_000_000, -150_000],
              [36.8, -1.3],
              [36.9, -1.4],
            ],
          },
        });
      expect(res.status).toBe(400);
      expect(ctx.network.addHeatZone).not.toHaveBeenCalled();
    });

    it("returns 409 when the total-zone cap is reached", async () => {
      (ctx.network.addHeatZone as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new HeatZoneCapError(HEAT_ZONE_DEFAULTS.MAX_TOTAL);
      });
      const res = await request(app).post("/heatzones").send({ geometry: validGeometry });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/limit/i);
    });

    it("rejects a polygon with fewer than 3 distinct points (400)", async () => {
      const res = await request(app)
        .post("/heatzones")
        .send({
          geometry: {
            type: "Polygon",
            coordinates: [
              [0, 0],
              [0, 0],
              [0, 0],
            ],
          },
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    });

    it("rejects a missing geometry (400)", async () => {
      const res = await request(app).post("/heatzones").send({ intensity: 0.5 });
      expect(res.status).toBe(400);
    });

    it("rejects intensity out of range (400)", async () => {
      const res = await request(app)
        .post("/heatzones")
        .send({ geometry: validGeometry, intensity: 2 });
      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /heatzones/:id", () => {
    it("updates a zone and returns 200 with the feature", async () => {
      const res = await request(app).patch("/heatzones/hz-1").send({ intensity: 0.9 });
      expect(res.status).toBe(200);
      expect(res.body.properties.id).toBe("hz-1");
      expect(ctx.network.updateHeatZone).toHaveBeenCalledWith(
        "hz-1",
        expect.objectContaining({ intensity: 0.9 })
      );
    });

    it("passes geometry coordinates as polygon on update", async () => {
      await request(app).patch("/heatzones/hz-1").send({ geometry: validGeometry });
      expect(ctx.network.updateHeatZone).toHaveBeenCalledWith(
        "hz-1",
        expect.objectContaining({ polygon: validGeometry.coordinates })
      );
    });

    it("returns 404 when the zone does not exist", async () => {
      (ctx.network.updateHeatZone as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const res = await request(app).patch("/heatzones/missing").send({ intensity: 0.5 });
      expect(res.status).toBe(404);
    });

    it("rejects a coordinate outside WGS84 range (400) without updating", async () => {
      const res = await request(app)
        .patch("/heatzones/hz-1")
        .send({
          geometry: {
            type: "Polygon",
            coordinates: [
              [4_000_000, -150_000],
              [36.8, -1.3],
              [36.9, -1.4],
            ],
          },
        });
      expect(res.status).toBe(400);
      expect(ctx.network.updateHeatZone).not.toHaveBeenCalled();
    });

    it("rejects an empty patch body (400)", async () => {
      const res = await request(app).patch("/heatzones/hz-1").send({});
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /heatzones/:id", () => {
    it("removes a zone and returns 204", async () => {
      const res = await request(app).delete("/heatzones/hz-1");
      expect(res.status).toBe(204);
      expect(ctx.network.removeHeatZone).toHaveBeenCalledWith("hz-1");
    });

    it("returns 404 when the zone does not exist", async () => {
      (ctx.network.removeHeatZone as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const res = await request(app).delete("/heatzones/missing");
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /heatzones", () => {
    it("clears all zones and returns 204", async () => {
      const res = await request(app).delete("/heatzones");
      expect(res.status).toBe(204);
      expect(ctx.network.clearHeatZones).toHaveBeenCalled();
    });
  });

  describe("POST /heatzones/seed", () => {
    it("seeds zones with an explicit count and returns 200 with the full list", async () => {
      const res = await request(app).post("/heatzones/seed").send({ count: 4 });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(ctx.network.seedHeatZones).toHaveBeenCalledWith(4);
    });

    it("seeds with the default count when omitted", async () => {
      const res = await request(app).post("/heatzones/seed").send({});
      expect(res.status).toBe(200);
      expect(ctx.network.seedHeatZones).toHaveBeenCalled();
    });
  });
});
