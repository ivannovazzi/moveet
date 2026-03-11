import type { Request, Response, NextFunction } from "express";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { RoadNetwork } from "./modules/RoadNetwork";
import { VehicleManager } from "./modules/VehicleManager";
import { SimulationController } from "./modules/SimulationController";
import { config, verifyConfig } from "./utils/config";
import { HEAT_ZONE_DEFAULTS } from "./constants";
import { generalRateLimiter, expensiveRateLimiter } from "./middleware/rateLimiter";
import logger from "./utils/logger";

verifyConfig();

const app = express();
app.use(cors({ origin: true }));
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
const vehicleManager = new VehicleManager(network);
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
    await simulationController.setDirections(req.body);
    res.json({ status: "direction" });
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

// ─── Fleet endpoints ──────────────────────────────────────────────

app.get("/fleets", (_req, res) => {
  try {
    res.json(vehicleManager.fleets.getAll());
  } catch (error) {
    logger.error(`Error in GET /fleets: ${error}`);
    res.status(500).json({ error: "Failed to get fleets" });
  }
});

app.post("/fleets", (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Missing or invalid 'name' field" });
      return;
    }
    const fleet = vehicleManager.fleets.create(name);
    res.status(201).json(fleet);
  } catch (error) {
    logger.error(`Error in POST /fleets: ${error}`);
    res.status(500).json({ error: "Failed to create fleet" });
  }
});

app.delete("/fleets/:id", (req, res) => {
  try {
    const deleted = vehicleManager.fleets.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Fleet not found" });
      return;
    }
    res.json({ status: "deleted" });
  } catch (error) {
    logger.error(`Error in DELETE /fleets/:id: ${error}`);
    res.status(500).json({ error: "Failed to delete fleet" });
  }
});

app.post("/fleets/assign", (req, res) => {
  try {
    const { fleetId, vehicleId } = req.body;
    if (!fleetId || !vehicleId) {
      res.status(400).json({ error: "Missing 'fleetId' or 'vehicleId'" });
      return;
    }
    const assigned = vehicleManager.assignVehicleToFleet(vehicleId, fleetId);
    if (!assigned) {
      res.status(404).json({ error: "Fleet or vehicle not found" });
      return;
    }
    res.json({ status: "assigned" });
  } catch (error) {
    logger.error(`Error in POST /fleets/assign: ${error}`);
    res.status(500).json({ error: "Failed to assign vehicle" });
  }
});

app.post("/fleets/unassign", (req, res) => {
  try {
    const { vehicleId } = req.body;
    if (!vehicleId) {
      res.status(400).json({ error: "Missing 'vehicleId'" });
      return;
    }
    const unassigned = vehicleManager.unassignVehicleFromFleet(vehicleId);
    if (!unassigned) {
      res.status(404).json({ error: "Vehicle not in any fleet" });
      return;
    }
    res.json({ status: "unassigned" });
  } catch (error) {
    logger.error(`Error in POST /fleets/unassign: ${error}`);
    res.status(500).json({ error: "Failed to unassign vehicle" });
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

  // WebSocket message handler factory
  function createWebSocketHandler<T>(ws: any, messageType: string) {
    return (data: T): void => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: messageType, data }));
      }
    };
  }

  wss.on("connection", (ws) => {
    logger.info("Client connected");

    // Create handlers using factory
    const heatzonesHandler = createWebSocketHandler(ws, "heatzones");
    const directionHandler = createWebSocketHandler(ws, "direction");
    const optionsUpdateHandler = createWebSocketHandler(ws, "options");
    const vehicleUpdateHandler = createWebSocketHandler(ws, "vehicle");
    const statusUpdateHandler = createWebSocketHandler(ws, "status");
    const resetHandler = createWebSocketHandler(ws, "reset");

    // Fleet event handlers
    const fleetCreatedHandler = createWebSocketHandler(ws, "fleet:created");
    const fleetDeletedHandler = createWebSocketHandler(ws, "fleet:deleted");
    const fleetAssignedHandler = createWebSocketHandler(ws, "fleet:assigned");

    // Register event listeners
    network.on("heatzones", heatzonesHandler);
    vehicleManager.on("update", vehicleUpdateHandler);
    vehicleManager.on("direction", directionHandler);
    vehicleManager.on("options", optionsUpdateHandler);
    simulationController.on("updateStatus", statusUpdateHandler);
    simulationController.on("reset", resetHandler);
    vehicleManager.fleets.on("fleet:created", fleetCreatedHandler);
    vehicleManager.fleets.on("fleet:deleted", fleetDeletedHandler);
    vehicleManager.fleets.on("fleet:assigned", fleetAssignedHandler);

    // Cleanup on disconnect
    ws.on("close", () => {
      network.removeListener("heatzones", heatzonesHandler);
      vehicleManager.removeListener("direction", directionHandler);
      vehicleManager.removeListener("update", vehicleUpdateHandler);
      vehicleManager.removeListener("options", optionsUpdateHandler);
      simulationController.removeListener("updateStatus", statusUpdateHandler);
      simulationController.removeListener("reset", resetHandler);
      vehicleManager.fleets.removeListener("fleet:created", fleetCreatedHandler);
      vehicleManager.fleets.removeListener("fleet:deleted", fleetDeletedHandler);
      vehicleManager.fleets.removeListener("fleet:assigned", fleetAssignedHandler);
      logger.info("Client disconnected");
    });
  });

  // Graceful shutdown handling
  function gracefulShutdown(signal: string): void {
    logger.info(`${signal} received. Starting graceful shutdown...`);

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
