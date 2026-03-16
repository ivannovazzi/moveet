import { Router } from "express";
import type { RouteContext } from "./types";

/**
 * Routes for fleet management: CRUD and vehicle assignment.
 */
export function createFleetRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { fleetManager } = ctx;

  router.get("/fleets", (_req, res) => {
    res.json(fleetManager.getFleets());
  });

  router.post("/fleets", (req, res) => {
    const { name, source } = req.body;
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const fleet = fleetManager.createFleet(name, source);
    res.status(201).json(fleet);
  });

  router.delete("/fleets/:id", (req, res) => {
    try {
      fleetManager.deleteFleet(req.params.id);
      res.json({ status: "deleted" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: message });
    }
  });

  router.post("/fleets/:id/assign", (req, res) => {
    const { vehicleIds } = req.body;
    if (!Array.isArray(vehicleIds)) {
      res.status(400).json({ error: "vehicleIds array is required" });
      return;
    }
    try {
      fleetManager.assignVehicles(req.params.id, vehicleIds);
      res.json({ status: "assigned" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: message });
    }
  });

  router.post("/fleets/:id/unassign", (req, res) => {
    const { vehicleIds } = req.body;
    if (!Array.isArray(vehicleIds)) {
      res.status(400).json({ error: "vehicleIds array is required" });
      return;
    }
    try {
      fleetManager.unassignVehicles(req.params.id, vehicleIds);
      res.json({ status: "unassigned" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: message });
    }
  });

  return router;
}
