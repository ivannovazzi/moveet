import { Router } from "express";
import type { GeoFenceManager } from "../modules/GeoFenceManager";
import type { CreateGeoFenceRequest } from "@moveet/shared-types";

/**
 * Creates Express routes for geofence zone CRUD operations.
 *
 * @param geoFenceManager  Shared GeoFenceManager instance
 */
export function createGeofenceRoutes(geoFenceManager: GeoFenceManager): Router {
  const router = Router();

  // POST /geofences — create a new zone
  router.post("/geofences", (req, res) => {
    const body = req.body as CreateGeoFenceRequest;

    if (!body.name || !body.type || !Array.isArray(body.polygon)) {
      res.status(400).json({ error: "name, type, and polygon are required" });
      return;
    }

    const fence = {
      id: crypto.randomUUID(),
      name: body.name,
      type: body.type,
      polygon: body.polygon,
      color: body.color,
      active: true,
    };

    geoFenceManager.addZone(fence);
    res.status(201).json(fence);
  });

  // GET /geofences — list all zones
  router.get("/geofences", (_req, res) => {
    res.json(geoFenceManager.getAllZones());
  });

  // GET /geofences/:id — get single zone
  router.get("/geofences/:id", (req, res) => {
    const zone = geoFenceManager.getZone(req.params.id);
    if (!zone) {
      res.status(404).json({ error: "Zone not found" });
      return;
    }
    res.json(zone);
  });

  // PUT /geofences/:id — full replace
  router.put("/geofences/:id", (req, res) => {
    const existing = geoFenceManager.getZone(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Zone not found" });
      return;
    }

    const body = req.body as Partial<CreateGeoFenceRequest> & { active?: boolean };
    const updated = geoFenceManager.updateZone(req.params.id, body);
    if (!updated) {
      res.status(404).json({ error: "Zone not found" });
      return;
    }
    res.json(updated);
  });

  // DELETE /geofences/:id — delete zone
  router.delete("/geofences/:id", (req, res) => {
    const removed = geoFenceManager.removeZone(req.params.id);
    if (!removed) {
      res.status(404).json({ error: "Zone not found" });
      return;
    }
    res.json({ status: "removed" });
  });

  // PATCH /geofences/:id/toggle — flip active flag
  router.patch("/geofences/:id/toggle", (req, res) => {
    const updated = geoFenceManager.toggleZone(req.params.id);
    if (!updated) {
      res.status(404).json({ error: "Zone not found" });
      return;
    }
    res.json(updated);
  });

  return router;
}
