import type { Request, Response, NextFunction } from "express";
import express from "express";
import compression from "compression";
import cors from "cors";
import path from "path";
import fs from "fs";
import { RoadNetwork } from "./modules/RoadNetwork";
import { VehicleManager } from "./modules/VehicleManager";
import { FleetManager } from "./modules/FleetManager";
import { IncidentManager } from "./modules/IncidentManager";
import { RecordingManager } from "./modules/RecordingManager";
import { SimulationController } from "./modules/SimulationController";
import { config, verifyConfig, logConfig } from "./utils/config";
import { generalRateLimiter } from "./middleware/rateLimiter";
import { correlationIdMiddleware } from "./middleware/correlationId";
import logger from "./utils/logger";
import {
  createVehicleRoutes,
  createSimulationRoutes,
  createNetworkRoutes,
  createIncidentRoutes,
  createRecordingRoutes,
  createReplayRoutes,
  createFleetRoutes,
} from "./routes";
import type { RouteContext } from "./routes";
import { setupWebSocket, wireEvents, registerGracefulShutdown } from "./setup";

verifyConfig();
logConfig();

const app = express();
app.use(cors({ origin: true }));
app.use(compression());
app.use(express.json());

// Correlation ID and request logging middleware
app.use(correlationIdMiddleware);

// Apply general rate limiting to all routes
app.use(generalRateLimiter.middleware());

// ─── Domain modules ──────────────────────────────────────────────────

const network = new RoadNetwork(config.geojsonPath);
const fleetManager = new FleetManager();
const incidentManager = new IncidentManager();
const vehicleManager = new VehicleManager(network, fleetManager);
const simulationController = new SimulationController(vehicleManager, incidentManager);
const recordingManager = new RecordingManager();

// ─── Route context shared by all route modules ──────────────────────

const ctx: RouteContext = {
  network,
  vehicleManager,
  fleetManager,
  incidentManager,
  recordingManager,
  simulationController,
};

// ─── Register routes ─────────────────────────────────────────────────

app.use(createSimulationRoutes(ctx));
app.use(createVehicleRoutes(ctx));
app.use(createNetworkRoutes(ctx));
app.use(createIncidentRoutes(ctx));
app.use(createRecordingRoutes(ctx));
app.use(createReplayRoutes(ctx));
app.use(createFleetRoutes(ctx));

// ─── API documentation ──────────────────────────────────────────────

app.get("/api-docs", (_req, res) => {
  const specPath = path.join(__dirname, "..", "openapi.yaml");
  if (!fs.existsSync(specPath)) {
    res.status(404).json({ error: "OpenAPI spec not found" });
    return;
  }
  res.type("text/yaml").send(fs.readFileSync(specPath, "utf-8"));
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({ error: "Internal server error" });
});

// ─── Server startup ──────────────────────────────────────────────────

async function main() {
  await vehicleManager.initFromAdapter();
  simulationController.markReady();

  const server = app.listen(config.port, () => {
    logger.info(`Server started on port ${config.port}`);
  });

  const { wss, broadcaster } = setupWebSocket(server);
  const { trafficBroadcastInterval } = wireEvents({ ...ctx, broadcaster });

  registerGracefulShutdown({
    server,
    wss,
    broadcaster,
    simulationController,
    network,
    trafficBroadcastInterval,
  });
}

main().catch((err) => {
  logger.error(`Failed to start server: ${err}`);
  process.exit(1);
});
