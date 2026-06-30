import { Router } from "express";
import { getMetrics, metricsContentType } from "../metrics";

/**
 * GET /metrics — Prometheus text exposition of all registered collectors
 * (default Node metrics + simulator-specific WS / adapter / HTTP metrics).
 */
export function createMetricsRoutes(): Router {
  const router = Router();

  router.get("/metrics", async (_req, res) => {
    try {
      const body = await getMetrics();
      res.set("Content-Type", metricsContentType);
      res.send(body);
    } catch (error) {
      res.status(500).json({ error: `Failed to collect metrics: ${error}` });
    }
  });

  return router;
}

export default createMetricsRoutes;
