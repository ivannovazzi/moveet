import { Router } from "express";
import type { RouteContext } from "./types";
import type { IncidentType } from "../types";
import { asyncHandler } from "./helpers";
import { validateBody } from "../middleware/validate";
import { createIncidentSchema, incidentAtPositionSchema } from "../middleware/schemas";
import { expensiveRateLimiter } from "../middleware/rateLimiter";
import logger from "../utils/logger";

const VALID_INCIDENT_TYPES: IncidentType[] = ["accident", "closure", "construction"];

/**
 * Routes for incident management: CRUD, random generation, position-based creation.
 */
export function createIncidentRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { network, incidentManager } = ctx;

  router.get("/incidents", (_req, res) => {
    try {
      const incidents = incidentManager.getActiveIncidents();
      res.json(incidents.map((i) => incidentManager.toDTO(i)));
    } catch (error) {
      logger.error(`Error in /incidents GET: ${error}`);
      res.status(500).json({ error: "Failed to get incidents" });
    }
  });

  router.post(
    "/incidents",
    expensiveRateLimiter.middleware(),
    validateBody(createIncidentSchema),
    asyncHandler(async (req, res) => {
      const { edgeIds, type, duration, severity } = req.body;

      const edge = network.getEdge(edgeIds[0]);
      const position: [number, number] = edge
        ? [
            (edge.start.coordinates[0] + edge.end.coordinates[0]) / 2,
            (edge.start.coordinates[1] + edge.end.coordinates[1]) / 2,
          ]
        : [0, 0];
      const incident = incidentManager.createIncident(edgeIds, type, duration, severity, position);
      res.status(201).json(incidentManager.toDTO(incident));
    })
  );

  router.delete("/incidents/:id", (_req, res) => {
    const removed = incidentManager.removeIncident(_req.params.id);
    if (!removed) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }
    res.json({ status: "removed" });
  });

  router.post(
    "/incidents/random",
    expensiveRateLimiter.middleware(),
    asyncHandler(async (_req, res) => {
      const edge = network.getRandomEdge();
      const type = VALID_INCIDENT_TYPES[Math.floor(Math.random() * VALID_INCIDENT_TYPES.length)];
      const duration = 30000 + Math.random() * 270000; // 30s to 5min
      const severity = 0.3 + Math.random() * 0.5; // 0.3 to 0.8
      const position: [number, number] = [
        (edge.start.coordinates[0] + edge.end.coordinates[0]) / 2,
        (edge.start.coordinates[1] + edge.end.coordinates[1]) / 2,
      ];

      const incident = incidentManager.createIncident([edge.id], type, duration, severity, position);
      res.status(201).json(incidentManager.toDTO(incident));
    })
  );

  router.post(
    "/incidents/at-position",
    expensiveRateLimiter.middleware(),
    validateBody(incidentAtPositionSchema),
    asyncHandler(async (req, res) => {
      const { lat, lng, type } = req.body;

      const node = network.findNearestNode([lat, lng]);
      if (node.connections.length === 0) {
        res.status(400).json({ error: "No road found near position" });
        return;
      }
      const edge = node.connections[0];
      const duration = 30000 + Math.random() * 270000;
      const severity = 0.3 + Math.random() * 0.5;
      const position: [number, number] = [
        (edge.start.coordinates[0] + edge.end.coordinates[0]) / 2,
        (edge.start.coordinates[1] + edge.end.coordinates[1]) / 2,
      ];

      const incident = incidentManager.createIncident([edge.id], type, duration, severity, position);
      res.status(201).json(incidentManager.toDTO(incident));
    })
  );

  return router;
}
