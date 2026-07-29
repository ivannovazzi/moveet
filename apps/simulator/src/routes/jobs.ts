import { Router, type Response } from "express";
import type { RouteContext } from "./types";
import { asyncHandler } from "./helpers";
import { validateBody } from "../middleware/validate";
import { assignJobSchema, createJobSchema } from "../middleware/schemas";

/**
 * Routes for the trip/job dispatch lifecycle: create (which also assigns),
 * re-assign, cancel, and remove finished jobs from the board.
 */
export function createJobRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { jobManager, network, vehicleManager } = ctx;

  /**
   * Rejects a named vehicle that cannot take the job.
   *
   * The zod schemas check the shape of `vehicleId`, not that it refers to a
   * vehicle that exists and is free. Without this the job is accepted and then
   * sits pending forever behind a unit that will never become available, which
   * reads to an operator as the simulator quietly ignoring their dispatch.
   */
  function rejectUnassignableVehicle(
    vehicleId: string,
    res: Response,
    /** Job being (re)assigned — a vehicle already on THIS job is not a conflict. */
    forJobId?: string
  ): boolean {
    if (!vehicleManager.hasVehicle(vehicleId)) {
      res.status(404).json({ error: `Vehicle "${vehicleId}" not found` });
      return true;
    }
    const holder = jobManager.jobForVehicleId(vehicleId);
    if (holder && holder.id !== forJobId) {
      // The conflicting job goes under its own key rather than `details`, which
      // everywhere else in this API is an array of validation strings.
      res.status(409).json({
        error: `Vehicle "${vehicleId}" is already on ${holder.reference}`,
        job: { id: holder.id, reference: holder.reference, status: holder.status },
      });
      return true;
    }
    return false;
  }

  /** Stops outside the loaded road network can never be routed to. */
  function stopOutOfBounds(lat: number, lng: number): boolean {
    const bbox = network.getBoundingBox();
    const MARGIN = 0.1;
    const midLatRad = (((bbox.minLat + bbox.maxLat) / 2) * Math.PI) / 180;
    const lngMargin = MARGIN / Math.max(Math.cos(midLatRad), 0.01);
    return (
      lat < bbox.minLat - MARGIN ||
      lat > bbox.maxLat + MARGIN ||
      lng < bbox.minLon - lngMargin ||
      lng > bbox.maxLon + lngMargin
    );
  }

  router.get("/jobs", (_req, res) => {
    res.json(jobManager.getJobs());
  });

  router.post(
    "/jobs",
    validateBody(createJobSchema),
    asyncHandler(async (req, res) => {
      const { pickup, dropoff } = req.body;
      const errors: string[] = [];
      if (stopOutOfBounds(pickup.lat, pickup.lng)) {
        errors.push("pickup is outside the road network bounds");
      }
      if (stopOutOfBounds(dropoff.lat, dropoff.lng)) {
        errors.push("dropoff is outside the road network bounds");
      }
      if (errors.length > 0) {
        res.status(400).json({ error: "Validation failed", details: errors });
        return;
      }
      if (req.body.vehicleId && rejectUnassignableVehicle(req.body.vehicleId, res)) return;

      const job = await jobManager.createJob(req.body);
      res.status(201).json(job);
    })
  );

  router.post(
    "/jobs/:id/assign",
    validateBody(assignJobSchema),
    asyncHandler(async (req, res) => {
      const jobId = req.params.id as string;
      if (req.body.vehicleId && rejectUnassignableVehicle(req.body.vehicleId, res, jobId)) return;
      try {
        const job = await jobManager.reassignJob(jobId, req.body);
        res.json(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(400).json({ error: message });
      }
    })
  );

  router.post("/jobs/:id/cancel", (req, res) => {
    try {
      res.json(jobManager.cancelJob(req.params.id as string));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: message });
    }
  });

  router.delete("/jobs/:id", (req, res) => {
    try {
      jobManager.deleteJob(req.params.id as string);
      res.json({ status: "deleted" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: message });
    }
  });

  return router;
}
