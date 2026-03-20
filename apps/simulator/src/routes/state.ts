import { Router } from "express";
import type { PersistenceManager } from "../modules/PersistenceManager";

/**
 * Creates Express routes for manual state persistence operations.
 *
 * @param persistenceManager  Shared PersistenceManager instance
 */
export function createStateRoutes(persistenceManager: PersistenceManager): Router {
  const router = Router();

  // POST /state/save — manual snapshot save
  router.post("/state/save", (_req, res) => {
    try {
      const meta = persistenceManager.saveNow();
      res.status(201).json({ status: "saved", ...meta });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  // POST /state/restore — restore from latest snapshot
  router.post("/state/restore", (_req, res) => {
    try {
      const restored = persistenceManager.restore();
      if (restored) {
        res.json({ status: "restored" });
      } else {
        res.status(404).json({ error: "No snapshot found" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  // GET /state/snapshots — list recent snapshots
  router.get("/state/snapshots", (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const snapshots = persistenceManager["stateStore"].listSnapshots(limit);
      res.json(snapshots);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
