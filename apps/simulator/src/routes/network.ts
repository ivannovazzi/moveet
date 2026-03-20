import { Router } from "express";
import type { RouteContext } from "./types";
import { HEAT_ZONE_DEFAULTS } from "../constants";
import logger from "../utils/logger";

/**
 * Routes for road network data: features, roads, POIs, heat zones.
 */
export function createNetworkRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { network } = ctx;

  router.get("/network", (_req, res) => {
    try {
      res.json(network.getFeatures());
    } catch (error) {
      logger.error(`Error in /network: ${error}`);
      res.status(500).json({ error: "Failed to get network data" });
    }
  });

  router.get("/roads", (_req, res) => {
    try {
      res.json(network.getAllRoads());
    } catch (error) {
      logger.error(`Error in /roads: ${error}`);
      res.status(500).json({ error: "Failed to get roads" });
    }
  });

  router.get("/pois", (_req, res) => {
    try {
      res.json(network.getAllPOIs());
    } catch (error) {
      logger.error(`Error in /pois: ${error}`);
      res.status(500).json({ error: "Failed to get POIs" });
    }
  });

  router.get("/speed-limits", (_req, res) => {
    try {
      res.json(network.getSpeedLimits());
    } catch (error) {
      logger.error(`Error in /speed-limits: ${error}`);
      res.status(500).json({ error: "Failed to get speed limits" });
    }
  });

  router.post("/heatzones", (_req, res) => {
    try {
      network.generateHeatedZones({
        count: HEAT_ZONE_DEFAULTS.COUNT,
        minRadius: HEAT_ZONE_DEFAULTS.MIN_RADIUS,
        maxRadius: HEAT_ZONE_DEFAULTS.MAX_RADIUS,
        minIntensity: HEAT_ZONE_DEFAULTS.MIN_INTENSITY,
        maxIntensity: HEAT_ZONE_DEFAULTS.MAX_INTENSITY,
      });
      res.json({ status: "heatzones generated" });
    } catch (error) {
      logger.error(`Error in /heatzones POST: ${error}`);
      res.status(500).json({ error: "Failed to generate heat zones" });
    }
  });

  router.get("/heatzones", (_req, res) => {
    try {
      res.json(network.exportHeatZones());
    } catch (error) {
      logger.error(`Error in /heatzones GET: ${error}`);
      res.status(500).json({ error: "Failed to get heat zones" });
    }
  });

  return router;
}
