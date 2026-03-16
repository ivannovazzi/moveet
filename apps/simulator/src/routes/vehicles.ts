import { Router } from "express";
import type { RouteContext } from "./types";
import { asyncHandler, validateCoordinates, validateSearchQuery } from "./helpers";
import { expensiveRateLimiter } from "../middleware/rateLimiter";
import { VEHICLE_PROFILES } from "../utils/vehicleProfiles";
import logger from "../utils/logger";

/**
 * Routes for vehicle management: listing, directions, node/road lookup, search.
 */
export function createVehicleRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { network, vehicleManager, simulationController } = ctx;

  router.get("/vehicle-types", (_req, res) => {
    res.json(VEHICLE_PROFILES);
  });

  router.get(
    "/vehicles",
    asyncHandler(async (_req, res) => {
      const vehicles = await vehicleManager.getVehicles();
      res.json(vehicles);
    })
  );

  router.get("/directions", (_req, res) => {
    try {
      res.json(vehicleManager.getDirections());
    } catch (error) {
      logger.error(`Error in /directions: ${error}`);
      res.status(500).json({ error: "Failed to get directions" });
    }
  });

  router.post(
    "/direction",
    asyncHandler(async (req, res) => {
      const body = req.body;

      // Validate request body is a non-empty array
      if (!Array.isArray(body) || body.length === 0) {
        res.status(400).json({
          error: "Request body must be a non-empty array of direction requests",
        });
        return;
      }

      // Validate each item in the array
      const errors: string[] = [];
      const bbox = network.getBoundingBox();
      // Add a margin (~10km) around the network bounding box for coordinate validation
      const MARGIN = 0.1;

      for (let i = 0; i < body.length; i++) {
        const item = body[i];

        // Validate id field
        if (typeof item.id !== "string" || item.id.length === 0) {
          errors.push(`[${i}]: 'id' must be a non-empty string`);
          continue;
        }

        // Validate vehicle ID exists
        if (!vehicleManager.hasVehicle(item.id)) {
          errors.push(`[${i}]: vehicle '${item.id}' not found`);
          continue;
        }

        if (Array.isArray(item.waypoints) && item.waypoints.length > 0) {
          // Multi-stop waypoint validation
          for (let j = 0; j < item.waypoints.length; j++) {
            const wp = item.waypoints[j];
            if (typeof wp.lat !== "number" || isNaN(wp.lat)) {
              errors.push(`[${i}].waypoints[${j}]: 'lat' must be a valid number`);
              continue;
            }
            if (typeof wp.lng !== "number" || isNaN(wp.lng)) {
              errors.push(`[${i}].waypoints[${j}]: 'lng' must be a valid number`);
              continue;
            }
            if (
              wp.lat < bbox.minLat - MARGIN ||
              wp.lat > bbox.maxLat + MARGIN ||
              wp.lng < bbox.minLon - MARGIN ||
              wp.lng > bbox.maxLon + MARGIN
            ) {
              errors.push(
                `[${i}].waypoints[${j}]: coordinates (${wp.lat}, ${wp.lng}) are outside the road network bounds`
              );
            }
          }
        } else {
          // Single-destination validation (backward compat)
          if (typeof item.lat !== "number" || isNaN(item.lat)) {
            errors.push(`[${i}]: 'lat' must be a valid number`);
          }
          if (typeof item.lng !== "number" || isNaN(item.lng)) {
            errors.push(`[${i}]: 'lng' must be a valid number`);
          }

          if (
            typeof item.lat !== "number" ||
            isNaN(item.lat) ||
            typeof item.lng !== "number" ||
            isNaN(item.lng)
          ) {
            continue;
          }

          if (
            item.lat < bbox.minLat - MARGIN ||
            item.lat > bbox.maxLat + MARGIN ||
            item.lng < bbox.minLon - MARGIN ||
            item.lng > bbox.maxLon + MARGIN
          ) {
            errors.push(
              `[${i}]: coordinates (${item.lat}, ${item.lng}) are outside the road network bounds`
            );
          }
        }
      }

      if (errors.length > 0) {
        res.status(400).json({ error: "Validation failed", details: errors });
        return;
      }

      const results = await simulationController.setDirections(body);
      res.json({ status: "direction", results });
    })
  );

  router.post(
    "/find-node",
    expensiveRateLimiter.middleware(),
    asyncHandler(async (req, res) => {
      if (!validateCoordinates(req.body)) {
        res.status(400).json({ error: "Invalid coordinates. Expected [longitude, latitude]" });
        return;
      }
      const { coordinates } = await network.findNearestNode([req.body[1], req.body[0]]);
      res.json([coordinates[1], coordinates[0]]);
    })
  );

  router.post(
    "/find-road",
    expensiveRateLimiter.middleware(),
    asyncHandler(async (req, res) => {
      if (!validateCoordinates(req.body)) {
        res.status(400).json({ error: "Invalid coordinates. Expected [longitude, latitude]" });
        return;
      }
      const road = await network.findNearestRoad([req.body[1], req.body[0]]);
      res.json(road);
    })
  );

  router.post(
    "/search",
    expensiveRateLimiter.middleware(),
    asyncHandler(async (req, res) => {
      if (!validateSearchQuery(req.body)) {
        res.status(400).json({ error: "Invalid request body. Expected { query: string }" });
        return;
      }
      const results = await network.searchByName(req.body.query);
      res.json(results);
    })
  );

  return router;
}
