import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createGeofenceRoutes } from "../../routes/geofences";

function createMockGeoFenceManager() {
  const zones = new Map<string, any>();
  return {
    addZone: vi.fn((zone: any) => zones.set(zone.id, zone)),
    getAllZones: vi.fn(() => Array.from(zones.values())),
    getZone: vi.fn((id: string) => zones.get(id) ?? null),
    updateZone: vi.fn((id: string, updates: any) => {
      const zone = zones.get(id);
      if (!zone) return null;
      const updated = { ...zone, ...updates };
      zones.set(id, updated);
      return updated;
    }),
    removeZone: vi.fn((id: string) => {
      if (!zones.has(id)) return false;
      zones.delete(id);
      return true;
    }),
    toggleZone: vi.fn((id: string) => {
      const zone = zones.get(id);
      if (!zone) return null;
      zone.active = !zone.active;
      return zone;
    }),
  };
}

function createApp(geoFenceManager: ReturnType<typeof createMockGeoFenceManager>) {
  const app = express();
  app.use(express.json());
  app.use(createGeofenceRoutes(geoFenceManager as any));
  return app;
}

describe("Geofence routes", () => {
  let manager: ReturnType<typeof createMockGeoFenceManager>;
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    manager = createMockGeoFenceManager();
    app = createApp(manager);
  });

  const validFence = {
    name: "Test Zone",
    type: "restricted",
    polygon: [
      [-1.28, 36.81],
      [-1.29, 36.82],
      [-1.3, 36.81],
      [-1.28, 36.81],
    ],
  };

  describe("POST /geofences", () => {
    it("should create a new geofence", async () => {
      const res = await request(app).post("/geofences").send(validFence);
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Test Zone");
      expect(res.body.type).toBe("restricted");
      expect(res.body.id).toBeDefined();
      expect(res.body.active).toBe(true);
      expect(manager.addZone).toHaveBeenCalled();
    });

    it("should reject missing name", async () => {
      const res = await request(app)
        .post("/geofences")
        .send({ type: "restricted", polygon: [[0, 0]] });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("required");
    });

    it("should reject missing type", async () => {
      const res = await request(app)
        .post("/geofences")
        .send({ name: "Test", polygon: [[0, 0]] });
      expect(res.status).toBe(400);
    });

    it("should reject missing polygon", async () => {
      const res = await request(app).post("/geofences").send({ name: "Test", type: "restricted" });
      expect(res.status).toBe(400);
    });

    it("should include color when provided", async () => {
      const res = await request(app)
        .post("/geofences")
        .send({ ...validFence, color: "#ff0000" });
      expect(res.status).toBe(201);
      expect(res.body.color).toBe("#ff0000");
    });
  });

  describe("GET /geofences", () => {
    it("should return all zones", async () => {
      const res = await request(app).get("/geofences");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("GET /geofences/:id", () => {
    it("should return a zone by id", async () => {
      manager.getZone.mockReturnValueOnce({
        id: "z1",
        name: "Zone 1",
        type: "restricted",
        active: true,
      });

      const res = await request(app).get("/geofences/z1");
      expect(res.status).toBe(200);
      expect(res.body.id).toBe("z1");
    });

    it("should return 404 for unknown zone", async () => {
      manager.getZone.mockReturnValueOnce(null);
      const res = await request(app).get("/geofences/unknown");
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("not found");
    });
  });

  describe("PUT /geofences/:id", () => {
    it("should update an existing zone", async () => {
      manager.getZone.mockReturnValueOnce({
        id: "z1",
        name: "Old Name",
        type: "restricted",
        active: true,
      });
      manager.updateZone.mockReturnValueOnce({
        id: "z1",
        name: "New Name",
        type: "restricted",
        active: true,
      });

      const res = await request(app).put("/geofences/z1").send({ name: "New Name" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("New Name");
    });

    it("should return 404 when zone does not exist", async () => {
      manager.getZone.mockReturnValueOnce(null);
      const res = await request(app).put("/geofences/unknown").send({ name: "X" });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /geofences/:id", () => {
    it("should remove a zone", async () => {
      manager.removeZone.mockReturnValueOnce(true);
      const res = await request(app).delete("/geofences/z1");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("removed");
    });

    it("should return 404 when zone does not exist", async () => {
      manager.removeZone.mockReturnValueOnce(false);
      const res = await request(app).delete("/geofences/unknown");
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /geofences/:id/toggle", () => {
    it("should toggle the active flag", async () => {
      manager.toggleZone.mockReturnValueOnce({
        id: "z1",
        name: "Zone",
        type: "restricted",
        active: false,
      });

      const res = await request(app).patch("/geofences/z1/toggle");
      expect(res.status).toBe(200);
      expect(res.body.active).toBe(false);
    });

    it("should return 404 when zone does not exist", async () => {
      manager.toggleZone.mockReturnValueOnce(null);
      const res = await request(app).patch("/geofences/unknown/toggle");
      expect(res.status).toBe(404);
    });
  });
});
