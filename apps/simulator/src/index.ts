import type { Request, Response, NextFunction } from "express";
import express from "express";
import compression from "compression";
import cors from "cors";
import { WebSocketServer } from "ws";
import { RoadNetwork } from "./modules/RoadNetwork";
import { VehicleManager } from "./modules/VehicleManager";
import { FleetManager } from "./modules/FleetManager";
import { SimulationController } from "./modules/SimulationController";
import { WebSocketBroadcaster } from "./modules/WebSocketBroadcaster";
import { config, verifyConfig } from "./utils/config";
import { HEAT_ZONE_DEFAULTS } from "./constants";
import { generalRateLimiter, expensiveRateLimiter } from "./middleware/rateLimiter";
import logger from "./utils/logger";

verifyConfig();

const app = express();
app.use(cors({ origin: true }));
app.use(compression());
app.use(express.json());

// Apply general rate limiting to all routes
app.use(generalRateLimiter.middleware());

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const originalSend = res.send;

  res.send = function (data): Response {
    const duration = Date.now() - startTime;
    logger.info(`${req.method} ${req.path} ${res.statusCode} - ${duration}ms`);
    return originalSend.call(this, data);
  };

  next();
});

const network = new RoadNetwork(config.geojsonPath);
const fleetManager = new FleetManager();
const vehicleManager = new VehicleManager(network, fleetManager);
const simulationController = new SimulationController(vehicleManager);

// Vehicles loaded in main() below, after await

// Error handling wrapper for async route handlers
const asyncHandler = (fn: (req: Request, res: Response) => Promise<void>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
};

// Input validation helpers
function validateCoordinates(body: unknown): body is [number, number] {
  return (
    Array.isArray(body) &&
    body.length === 2 &&
    typeof body[0] === "number" &&
    typeof body[1] === "number" &&
    !isNaN(body[0]) &&
    !isNaN(body[1])
  );
}

function validateSearchQuery(body: unknown): body is { query: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    "query" in body &&
    typeof (body as { query: unknown }).query === "string" &&
    (body as { query: string }).query.length > 0
  );
}

app.get("/status", (_req, res) => {
  try {
    res.json(simulationController.getStatus());
  } catch (error) {
    logger.error(`Error in /status: ${error}`);
    res.status(500).json({ error: "Failed to get status" });
  }
});

app.post(
  "/reset",
  asyncHandler(async (_req, res) => {
    await simulationController.reset();
    res.json({ status: "reset" });
  })
);

app.post(
  "/start",
  asyncHandler(async (req, res) => {
    await simulationController.start(req.body);
    res.json({ status: "started" });
  })
);

app.post("/stop", (_req, res) => {
  try {
    simulationController.stop();
    res.json({ status: "stopped" });
  } catch (error) {
    logger.error(`Error in /stop: ${error}`);
    res.status(500).json({ error: "Failed to stop simulation" });
  }
});

app.post(
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

      // Validate lat/lng fields are numeric
      if (typeof item.lat !== "number" || isNaN(item.lat)) {
        errors.push(`[${i}]: 'lat' must be a valid number`);
      }
      if (typeof item.lng !== "number" || isNaN(item.lng)) {
        errors.push(`[${i}]: 'lng' must be a valid number`);
      }

      // Skip further validation if lat/lng are not valid numbers
      if (typeof item.lat !== "number" || isNaN(item.lat) || typeof item.lng !== "number" || isNaN(item.lng)) {
        continue;
      }

      // Validate vehicle ID exists
      if (!vehicleManager.hasVehicle(item.id)) {
        errors.push(`[${i}]: vehicle '${item.id}' not found`);
      }

      // Validate coordinates are within network bounds (with margin)
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

    if (errors.length > 0) {
      res.status(400).json({ error: "Validation failed", details: errors });
      return;
    }

    const results = await simulationController.setDirections(body);
    res.json({ status: "direction", results });
  })
);

app.post(
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

app.post(
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

app.get("/options", (_req, res) => {
  try {
    res.json(vehicleManager.getOptions());
  } catch (error) {
    logger.error(`Error in /options: ${error}`);
    res.status(500).json({ error: "Failed to get options" });
  }
});

app.post(
  "/options",
  asyncHandler(async (req, res) => {
    await simulationController.setOptions(req.body);
    res.json({ status: "options set" });
  })
);

app.get(
  "/vehicles",
  asyncHandler(async (_req, res) => {
    const vehicles = await vehicleManager.getVehicles();
    res.json(vehicles);
  })
);

app.get("/network", (_req, res) => {
  try {
    res.json(network.getFeatures());
  } catch (error) {
    logger.error(`Error in /network: ${error}`);
    res.status(500).json({ error: "Failed to get network data" });
  }
});

app.get("/roads", (_req, res) => {
  try {
    res.json(network.getAllRoads());
  } catch (error) {
    logger.error(`Error in /roads: ${error}`);
    res.status(500).json({ error: "Failed to get roads" });
  }
});

app.get("/pois", (_req, res) => {
  try {
    res.json(network.getAllPOIs());
  } catch (error) {
    logger.error(`Error in /pois: ${error}`);
    res.status(500).json({ error: "Failed to get POIs" });
  }
});

app.get("/directions", (_req, res) => {
  try {
    res.json(vehicleManager.getDirections());
  } catch (error) {
    logger.error(`Error in /directions: ${error}`);
    res.status(500).json({ error: "Failed to get directions" });
  }
});

app.post(
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

app.post("/heatzones", (_req, res) => {
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

app.get("/heatzones", (_req, res) => {
  try {
    res.json(network.exportHeatZones());
  } catch (error) {
    logger.error(`Error in /heatzones GET: ${error}`);
    res.status(500).json({ error: "Failed to get heat zones" });
  }
});

app.get("/fleets", (_req, res) => {
  res.json(fleetManager.getFleets());
});

app.post("/fleets", (req, res) => {
  const { name, source } = req.body;
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const fleet = fleetManager.createFleet(name, source);
  res.status(201).json(fleet);
});

app.delete("/fleets/:id", (req, res) => {
  try {
    fleetManager.deleteFleet(req.params.id);
    res.json({ status: "deleted" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: message });
  }
});

app.post("/fleets/:id/assign", (req, res) => {
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

app.post("/fleets/:id/unassign", (req, res) => {
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

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({ error: "Internal server error" });
});

async function main() {
  await vehicleManager.initFromAdapter();
  simulationController.markReady();

  const server = app.listen(config.port, () => {
    logger.info(`Server started on port ${config.port}`);
  });

  const wss = new WebSocketServer({ server });
  const broadcaster = new WebSocketBroadcaster(wss, { flushIntervalMs: 100 });
  broadcaster.start();

  // Vehicle updates are batched by the broadcaster
  vehicleManager.on("update", (data) => {
    broadcaster.queueVehicleUpdate(data);
  });

  // Non-vehicle events are broadcast immediately
  network.on("heatzones", (data) => broadcaster.broadcast("heatzones", data));
  vehicleManager.on("direction", (data) => broadcaster.broadcast("direction", data));
  vehicleManager.on("options", (data) => broadcaster.broadcast("options", data));
  simulationController.on("updateStatus", (data) => broadcaster.broadcast("status", data));
  simulationController.on("reset", (data) => broadcaster.broadcast("reset", data));
  fleetManager.on("fleet:created", (data) => broadcaster.broadcast("fleet:created", data));
  fleetManager.on("fleet:deleted", (data) => broadcaster.broadcast("fleet:deleted", data));
  fleetManager.on("fleet:assigned", (data) => broadcaster.broadcast("fleet:assigned", data));

  wss.on("connection", (ws) => {
    logger.info(`Client connected (total: ${broadcaster.clientCount})`);

    ws.on("close", () => {
      logger.info(`Client disconnected (total: ${broadcaster.clientCount})`);
    });
  });

  // Graceful shutdown handling
  function gracefulShutdown(signal: string): void {
    logger.info(`${signal} received. Starting graceful shutdown...`);

    broadcaster.stop();
    logger.info("WebSocket broadcaster stopped");

    server.close(() => {
      logger.info("HTTP server closed");
    });

    wss.clients.forEach((client) => {
      client.close();
    });
    wss.close(() => {
      logger.info("WebSocket server closed");
    });

    simulationController.stop();
    logger.info("Simulation stopped");

    network.shutdownWorkers();
    logger.info("Pathfinding workers stopped");

    generalRateLimiter.cleanup();
    expensiveRateLimiter.cleanup();
    logger.info("Rate limiters cleaned up");

    setTimeout(() => {
      logger.info("Shutdown complete");
      process.exit(0);
    }, 1000);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  process.on("uncaughtException", (error) => {
    logger.error(`Uncaught exception: ${error.message}`);
    gracefulShutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
    gracefulShutdown("unhandledRejection");
  });
}

main().catch((err) => {
  logger.error(`Failed to start server: ${err}`);
  process.exit(1);
});
