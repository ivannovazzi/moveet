import { Router } from "express";
import type { RouteContext } from "./types";

/**
 * Routes for fleet analytics: summary, per-fleet breakdown, history, and reset.
 */
export function createAnalyticsRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { vehicleManager, stateStore } = ctx;

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
   * GET /analytics/history?from=ISO&to=ISO&limit=N
   * Returns time-series analytics history from the SQLite store.
   * Only available when persistence is enabled.
   */
  router.get("/analytics/history", (req, res) => {
    if (!stateStore) {
      res.status(503).json({ error: "Persistence is not enabled" });
      return;
    }

    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const limitParam = req.query.limit as string | undefined;
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    if (limitParam !== undefined && (isNaN(limit!) || limit! < 1)) {
      res.status(400).json({ error: "limit must be a positive integer" });
      return;
    }

    const history = stateStore.getAnalyticsHistory(from, to, limit);
    res.json(history);
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
