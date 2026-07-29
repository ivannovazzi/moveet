import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createJobRoutes } from "../../routes/jobs";
import type { RouteContext } from "../../routes/types";
import type { JobDTO } from "@moveet/shared-types";

/** Nairobi-ish box; every in-bounds fixture below sits inside it. */
const BBOX = { minLat: -1.4, maxLat: -1.2, minLon: 36.7, maxLon: 37.0 };

const IN_BOUNDS = { lat: -1.3, lng: 36.85 };
const FAR_AWAY = { lat: 48.85, lng: 2.35 };

function job(overrides: Partial<JobDTO> = {}): JobDTO {
  return {
    id: "job-1",
    reference: "JOB-0001",
    status: "en_route",
    pickup: { position: [IN_BOUNDS.lat, IN_BOUNDS.lng] },
    dropoff: { position: [-1.31, 36.9] },
    strategy: "nearest",
    createdAt: 0,
    slaSeconds: 900,
    slaDeadline: 900_000,
    slaBreached: false,
    ...overrides,
  };
}

function createMockContext(): RouteContext {
  return {
    network: {
      getBoundingBox: vi.fn().mockReturnValue(BBOX),
    } as unknown as RouteContext["network"],
    vehicleManager: {} as RouteContext["vehicleManager"],
    fleetManager: {} as RouteContext["fleetManager"],
    jobManager: {
      getJobs: vi.fn().mockReturnValue([job()]),
      createJob: vi.fn().mockResolvedValue(job()),
      reassignJob: vi.fn().mockResolvedValue(job({ vehicleId: "v2" })),
      cancelJob: vi.fn().mockReturnValue(job({ status: "cancelled" })),
      deleteJob: vi.fn(),
    } as unknown as RouteContext["jobManager"],
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
  app.use(createJobRoutes(ctx));
  return app;
}

describe("Job routes", () => {
  let ctx: RouteContext;
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    ctx = createMockContext();
    app = createApp(ctx);
  });

  describe("GET /jobs", () => {
    it("returns the whole board", async () => {
      const res = await request(app).get("/jobs");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].reference).toBe("JOB-0001");
    });
  });

  describe("POST /jobs", () => {
    it("creates a job and returns it post-assignment", async () => {
      const body = { pickup: IN_BOUNDS, dropoff: { lat: -1.31, lng: 36.9 } };

      const res = await request(app).post("/jobs").send(body);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("en_route");
      expect(ctx.jobManager.createJob).toHaveBeenCalledWith(expect.objectContaining(body));
    });

    it("accepts a strategy and SLA budget", async () => {
      const res = await request(app)
        .post("/jobs")
        .send({
          pickup: IN_BOUNDS,
          dropoff: { lat: -1.31, lng: 36.9 },
          strategy: "best_eta",
          slaSeconds: 300,
        });

      expect(res.status).toBe(201);
      expect(ctx.jobManager.createJob).toHaveBeenCalledWith(
        expect.objectContaining({ strategy: "best_eta", slaSeconds: 300 })
      );
    });

    it("rejects a missing dropoff", async () => {
      const res = await request(app).post("/jobs").send({ pickup: IN_BOUNDS });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
      expect(ctx.jobManager.createJob).not.toHaveBeenCalled();
    });

    it("rejects an unknown strategy", async () => {
      const res = await request(app)
        .post("/jobs")
        .send({ pickup: IN_BOUNDS, dropoff: { lat: -1.31, lng: 36.9 }, strategy: "vibes" });

      expect(res.status).toBe(400);
    });

    it("rejects the manual strategy without a vehicleId", async () => {
      const res = await request(app)
        .post("/jobs")
        .send({ pickup: IN_BOUNDS, dropoff: { lat: -1.31, lng: 36.9 }, strategy: "manual" });

      expect(res.status).toBe(400);
      expect(ctx.jobManager.createJob).not.toHaveBeenCalled();
    });

    it("rejects a pickup outside the road network", async () => {
      const res = await request(app)
        .post("/jobs")
        .send({ pickup: FAR_AWAY, dropoff: { lat: -1.31, lng: 36.9 } });

      expect(res.status).toBe(400);
      expect(res.body.details).toContain("pickup is outside the road network bounds");
      expect(ctx.jobManager.createJob).not.toHaveBeenCalled();
    });

    it("rejects a dropoff outside the road network", async () => {
      const res = await request(app).post("/jobs").send({ pickup: IN_BOUNDS, dropoff: FAR_AWAY });

      expect(res.status).toBe(400);
      expect(res.body.details).toContain("dropoff is outside the road network bounds");
    });

    it("rejects an out-of-range latitude before any bounds check", async () => {
      const res = await request(app)
        .post("/jobs")
        .send({ pickup: { lat: 120, lng: 36.85 }, dropoff: { lat: -1.31, lng: 36.9 } });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    });
  });

  describe("POST /jobs/:id/assign", () => {
    it("re-assigns a job to a named vehicle", async () => {
      const res = await request(app).post("/jobs/job-1/assign").send({ vehicleId: "v2" });

      expect(res.status).toBe(200);
      expect(res.body.vehicleId).toBe("v2");
      expect(ctx.jobManager.reassignJob).toHaveBeenCalledWith("job-1", { vehicleId: "v2" });
    });

    it("surfaces a manager rejection as a 400", async () => {
      vi.mocked(ctx.jobManager.reassignJob).mockRejectedValue(
        new Error("Job JOB-0001 has already been picked up")
      );

      const res = await request(app).post("/jobs/job-1/assign").send({ vehicleId: "v2" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Job JOB-0001 has already been picked up");
    });

    it("rejects the manual strategy without a vehicleId", async () => {
      const res = await request(app).post("/jobs/job-1/assign").send({ strategy: "manual" });

      expect(res.status).toBe(400);
      expect(ctx.jobManager.reassignJob).not.toHaveBeenCalled();
    });
  });

  describe("POST /jobs/:id/cancel", () => {
    it("cancels a live job", async () => {
      const res = await request(app).post("/jobs/job-1/cancel");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("cancelled");
      expect(ctx.jobManager.cancelJob).toHaveBeenCalledWith("job-1");
    });

    it("surfaces a manager rejection as a 400", async () => {
      vi.mocked(ctx.jobManager.cancelJob).mockImplementation(() => {
        throw new Error("Job JOB-0001 is already complete");
      });

      const res = await request(app).post("/jobs/job-1/cancel");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Job JOB-0001 is already complete");
    });
  });

  describe("DELETE /jobs/:id", () => {
    it("removes a finished job", async () => {
      const res = await request(app).delete("/jobs/job-1");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("deleted");
      expect(ctx.jobManager.deleteJob).toHaveBeenCalledWith("job-1");
    });

    it("surfaces a manager rejection as a 400", async () => {
      vi.mocked(ctx.jobManager.deleteJob).mockImplementation(() => {
        throw new Error("Job JOB-0001 is still en_route; cancel it first");
      });

      const res = await request(app).delete("/jobs/job-1");

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cancel it first/);
    });
  });
});
