import { Router } from "express";
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
  const { jobManager, network } = ctx;

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

      const job = await jobManager.createJob(req.body);
      res.status(201).json(job);
    })
  );

  router.post(
    "/jobs/:id/assign",
    validateBody(assignJobSchema),
    asyncHandler(async (req, res) => {
      try {
        const job = await jobManager.reassignJob(req.params.id as string, req.body);
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
