import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createFleetRoutes } from "../../routes/fleets";
import type { RouteContext } from "../../routes/types";

function createMockContext(): RouteContext {
  return {
    network: {} as RouteContext["network"],
    vehicleManager: {} as RouteContext["vehicleManager"],
    fleetManager: {
      getFleets: vi
        .fn()
        .mockReturnValue([
          { id: "f1", name: "Fleet A", color: "#e6194b", source: "local", vehicleIds: ["v1"] },
        ]),
      createFleet: vi.fn().mockReturnValue({
        id: "f2",
        name: "Fleet B",
        color: "#3cb44b",
        source: "local",
        vehicleIds: [],
      }),
      deleteFleet: vi.fn(),
      assignVehicles: vi.fn(),
      unassignVehicles: vi.fn(),
    } as unknown as RouteContext["fleetManager"],
    incidentManager: {} as RouteContext["incidentManager"],
    recordingManager: {} as RouteContext["recordingManager"],
    simulationController: {} as RouteContext["simulationController"],
  };
}

function createApp(ctx: RouteContext) {
  const app = express();
  app.use(express.json());
  app.use(createFleetRoutes(ctx));
  return app;
}

describe("Fleet routes", () => {
  let ctx: RouteContext;
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    ctx = createMockContext();
    app = createApp(ctx);
  });

  describe("GET /fleets", () => {
    it("should return all fleets", async () => {
      const res = await request(app).get("/fleets");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe("Fleet A");
    });
  });

  describe("POST /fleets", () => {
    it("should create a fleet with valid name", async () => {
      const res = await request(app).post("/fleets").send({ name: "Fleet B" });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Fleet B");
      expect(ctx.fleetManager.createFleet).toHaveBeenCalledWith("Fleet B", undefined);
    });

    it("should reject missing name", async () => {
      const res = await request(app).post("/fleets").send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
      expect(res.body.details.some((d: string) => d.includes("name"))).toBe(true);
    });

    it("should reject non-string name", async () => {
      const res = await request(app).post("/fleets").send({ name: 42 });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /fleets/:id", () => {
    it("should delete a fleet", async () => {
      const res = await request(app).delete("/fleets/f1");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "deleted" });
      expect(ctx.fleetManager.deleteFleet).toHaveBeenCalledWith("f1");
    });

    it("should return 400 if deleteFleet throws", async () => {
      (ctx.fleetManager.deleteFleet as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Fleet not found");
      });
      const res = await request(app).delete("/fleets/bad-id");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Fleet not found");
    });
  });

  describe("POST /fleets/:id/assign", () => {
    it("should assign vehicles to a fleet", async () => {
      const res = await request(app)
        .post("/fleets/f1/assign")
        .send({ vehicleIds: ["v1", "v2"] });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "assigned" });
      expect(ctx.fleetManager.assignVehicles).toHaveBeenCalledWith("f1", ["v1", "v2"]);
    });

    it("should reject missing vehicleIds", async () => {
      const res = await request(app).post("/fleets/f1/assign").send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
      expect(res.body.details.some((d: string) => d.includes("vehicleIds"))).toBe(true);
    });

    it("should return 400 if assignVehicles throws", async () => {
      (ctx.fleetManager.assignVehicles as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Fleet not found");
      });
      const res = await request(app)
        .post("/fleets/f1/assign")
        .send({ vehicleIds: ["v1"] });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /fleets/:id/unassign", () => {
    it("should unassign vehicles from a fleet", async () => {
      const res = await request(app)
        .post("/fleets/f1/unassign")
        .send({ vehicleIds: ["v1"] });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "unassigned" });
    });

    it("should reject missing vehicleIds", async () => {
      const res = await request(app).post("/fleets/f1/unassign").send({});
      expect(res.status).toBe(400);
    });

    it("should return 400 if unassignVehicles throws", async () => {
      (ctx.fleetManager.unassignVehicles as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Fleet not found");
      });
      const res = await request(app)
        .post("/fleets/f1/unassign")
        .send({ vehicleIds: ["v1"] });
      expect(res.status).toBe(400);
    });
  });
});
