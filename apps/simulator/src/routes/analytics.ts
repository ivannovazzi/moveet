import { Router } from "express";
import type { RouteContext } from "./types";

/**
 * Routes for fleet analytics: summary, per-fleet breakdown, and reset.
 */
export function createAnalyticsRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { vehicleManager } = ctx;

  /**
   * GET /analytics/summary
   * Returns aggregate analytics across all vehicles.
   */
  router.get("/analytics/summary", (_req, res) => {
    const summary = vehicleManager.analytics.getSummary();
    res.json(summary);
  });

  /**
   * GET /analytics/fleet/:id
   * Returns analytics for a specific fleet, including per-vehicle breakdown.
   */
  router.get("/analytics/fleet/:id", (req, res) => {
    const fleetId = req.params.id;
    const fleetStats = vehicleManager.analytics.getFleetStats(fleetId);
    res.json(fleetStats);
  });

  /**
   * POST /analytics/reset
   * Resets all accumulated analytics data.
   */
  router.post("/analytics/reset", (_req, res) => {
    vehicleManager.analytics.resetStats();
    res.json({ ok: true });
  });

  return router;
}
