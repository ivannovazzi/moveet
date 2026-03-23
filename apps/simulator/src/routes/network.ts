import { Router } from "express";
import type { RouteContext } from "./types";
import { HEAT_ZONE_DEFAULTS } from "../constants";

/**
 * Routes for road network data: features, roads, POIs, heat zones.
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

  router.post("/heatzones", (_req, res) => {
    network.generateHeatedZones({
      count: HEAT_ZONE_DEFAULTS.COUNT,
      minRadius: HEAT_ZONE_DEFAULTS.MIN_RADIUS,
      maxRadius: HEAT_ZONE_DEFAULTS.MAX_RADIUS,
      minIntensity: HEAT_ZONE_DEFAULTS.MIN_INTENSITY,
      maxIntensity: HEAT_ZONE_DEFAULTS.MAX_INTENSITY,
    });
    res.json({ status: "heatzones generated" });
  });

  router.get("/heatzones", (_req, res) => {
    res.json(network.exportHeatZones());
  });

  return router;
}
