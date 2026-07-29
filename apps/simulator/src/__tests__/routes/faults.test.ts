import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createFaultRoutes } from "../../routes/faults";
import { DeviceFaultManager } from "../../modules/faults/DeviceFaultManager";
import type { RouteContext } from "../../routes/types";

describe("fault routes", () => {
  let faults: DeviceFaultManager;
  let app: express.Express;

  beforeEach(() => {
    faults = new DeviceFaultManager();
    const ctx = { vehicleManager: { faults } } as unknown as RouteContext;
    app = express();
    app.use(express.json());
    app.use(createFaultRoutes(ctx));
  });

  describe("GET /faults", () => {
    it("returns the configuration and a live status snapshot", async () => {
      const res = await request(app).get("/faults");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ enabled: false, vehicles: {} });
      expect(res.body.status).toMatchObject({ enabled: false, devices: 0, queued: 0 });
      expect(res.body.status.counts).toMatchObject({ frozen_gps: 0, battery_dead: 0 });
    });
  });

  describe("POST /faults", () => {
    it("arms the layer and echoes the resolved configuration", async () => {
      const res = await request(app)
        .post("/faults")
        .send({ enabled: true, seed: 7, default: { clockSkew: { offsetMs: 2500 } } });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        enabled: true,
        seed: 7,
        default: { clockSkew: { offsetMs: 2500 } },
        vehicles: {},
      });
      expect(faults.isActive()).toBe(true);
    });

    it("clears the fleet-wide default with an explicit null", async () => {
      await request(app)
        .post("/faults")
        .send({ enabled: true, default: { clockSkew: { offsetMs: 1 } } });

      const res = await request(app).post("/faults").send({ default: null });

      expect(res.status).toBe(200);
      expect(res.body.default).toBeUndefined();
    });

    it("rejects an unknown key so a typo cannot silently arm nothing", async () => {
      const res = await request(app)
        .post("/faults")
        .send({ default: { frozenGPS: { probability: 1 } } });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
      expect(res.body.details.join(" ")).toMatch(/frozenGPS/);
    });

    it("rejects an out-of-range probability", async () => {
      const res = await request(app)
        .post("/faults")
        .send({ default: { duplicate: { probability: 5, maxCopies: 1 } } });

      expect(res.status).toBe(400);
      expect(res.body.details.join(" ")).toMatch(/probability/);
    });

    it("rejects a frozen window whose max is below its min", async () => {
      const res = await request(app)
        .post("/faults")
        .send({
          default: { frozenGps: { probability: 1, minDurationMs: 9000, maxDurationMs: 1000 } },
        });

      expect(res.status).toBe(400);
      expect(res.body.details.join(" ")).toMatch(/maxDurationMs must be >= minDurationMs/);
    });
  });

  describe("PUT /faults/vehicles/:id", () => {
    it("sets one vehicle's profile", async () => {
      const res = await request(app)
        .put("/faults/vehicles/v1")
        .send({ teleport: { probability: 0.2, radiusMeters: 800, holdMs: 0 } });

      expect(res.status).toBe(200);
      expect(res.body.vehicles.v1).toEqual({
        teleport: { probability: 0.2, radiusMeters: 800, holdMs: 0 },
      });
    });

    it("validates the profile body", async () => {
      const res = await request(app).put("/faults/vehicles/v1").send({ battery: {} });

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /faults/vehicles/:id", () => {
    it("removes an existing profile", async () => {
      await request(app)
        .put("/faults/vehicles/v1")
        .send({ clockSkew: { offsetMs: 10 } });

      const res = await request(app).delete("/faults/vehicles/v1");

      expect(res.status).toBe(200);
      expect(res.body.vehicles).toEqual({});
    });

    it("404s for a vehicle with no profile", async () => {
      const res = await request(app).delete("/faults/vehicles/ghost");

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/No fault profile/);
    });
  });

  describe("GET /faults/status and POST /faults/reset", () => {
    it("reports live device state and clears it on reset", async () => {
      faults.configure({
        enabled: true,
        seed: 1,
        default: { frozenGps: { probability: 1, minDurationMs: 60_000, maxDurationMs: 60_000 } },
      });
      faults.report(
        { id: "v1", name: "V1", type: "car", position: [-1.3, 36.85], speed: 30, heading: 0 },
        Date.now()
      );

      const before = await request(app).get("/faults/status");
      expect(before.body).toMatchObject({ devices: 1, frozen: 1, queued: 1 });
      expect(before.body.counts.frozen_gps).toBe(1);

      const after = await request(app).post("/faults/reset");
      expect(after.status).toBe(200);
      expect(after.body).toMatchObject({ devices: 0, frozen: 0, queued: 0 });
      expect(after.body.counts.frozen_gps).toBe(0);
      // Reset clears device state, not the configuration.
      expect(faults.isActive()).toBe(true);
    });
  });
});
