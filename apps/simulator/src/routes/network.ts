import { Router } from "express";
import type { RouteContext } from "./types";
import { validateBody } from "../middleware/validate";
import {
  createHeatzoneSchema,
  updateHeatzoneSchema,
  seedHeatzoneSchema,
} from "../middleware/schemas";
import { HeatZoneCapError } from "../modules/HeatZoneManager";

/**
 * Routes for road network data: features, roads, POIs, and manual heat zones.
 *
 * Heat zones are authoritative and manually controlled: they are created,
 * edited, deleted, seeded, and cleared via these endpoints. Every mutation goes
 * through a RoadNetwork method that re-broadcasts the full list on the
 * `heatzones` WebSocket channel, so all clients converge on the server state.
 */
export function createNetworkRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { network } = ctx;

  router.get("/network", (_req, res) => {
    res.json(network.getFeatures());
  });

  router.get("/roads", (_req, res) => {
    res.json(network.getAllRoads());
  });

  router.get("/pois", (_req, res) => {
    res.json(network.getAllPOIs());
  });

  router.get("/speed-limits", (_req, res) => {
    res.json(network.getSpeedLimits());
  });

  // ─── Heat zones ───────────────────────────────────────────────────

  router.get("/heatzones", (_req, res) => {
    res.json(network.exportHeatZones());
  });

  router.post("/heatzones", validateBody(createHeatzoneSchema), (req, res) => {
    // The schema applies HEAT_ZONE_DEFAULTS.DEFAULT_INTENSITY, so `intensity` is
    // always present here (single source of truth for the default).
    const { geometry, intensity } = req.body as {
      geometry: { type: "Polygon"; coordinates: [number, number][] };
      intensity: number;
    };
    try {
      const feature = network.addHeatZone({
        polygon: geometry.coordinates,
        intensity,
      });
      res.status(201).json(feature);
    } catch (err) {
      if (err instanceof HeatZoneCapError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // Seed random zones (appends). Registered before the "/heatzones/:id"
  // handlers, though the distinct path already disambiguates it.
  router.post("/heatzones/seed", validateBody(seedHeatzoneSchema), (req, res) => {
    const { count } = req.body as { count?: number };
    const zones = network.seedHeatZones(count);
    res.status(200).json(zones);
  });

  router.patch("/heatzones/:id", validateBody(updateHeatzoneSchema), (req, res) => {
    const { geometry, intensity } = req.body as {
      geometry?: { type: "Polygon"; coordinates: [number, number][] };
      intensity?: number;
    };
    const patch: { polygon?: [number, number][]; intensity?: number } = {};
    if (geometry) patch.polygon = geometry.coordinates;
    if (intensity !== undefined) patch.intensity = intensity;

    const feature = network.updateHeatZone(req.params.id as string, patch);
    if (!feature) {
      res.status(404).json({ error: "Heat zone not found" });
      return;
    }
    res.status(200).json(feature);
  });

  router.delete("/heatzones/:id", (req, res) => {
    const removed = network.removeHeatZone(req.params.id);
    if (!removed) {
      res.status(404).json({ error: "Heat zone not found" });
      return;
    }
    res.status(204).end();
  });

  router.delete("/heatzones", (_req, res) => {
    network.clearHeatZones();
    res.status(204).end();
  });

  return router;
}
