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
import { GeoFenceManager } from "./modules/GeoFenceManager";
import { ScenarioManager } from "./modules/scenario";
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
  createAnalyticsRoutes,
  createScenarioRoutes,
} from "./routes";
import { createGeofenceRoutes } from "./routes/geofences";
import type { RouteContext } from "./routes";
import { setupWebSocket, wireEvents, registerGracefulShutdown } from "./setup";
import { apiReference } from "@scalar/express-api-reference";

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

const serverStartTime = Date.now();

// ─── Domain modules ──────────────────────────────────────────────────

const network = new RoadNetwork(config.geojsonPath);
const fleetManager = new FleetManager();
const incidentManager = new IncidentManager();
const vehicleManager = new VehicleManager(network, fleetManager);
const simulationController = new SimulationController(vehicleManager, incidentManager);
const recordingManager = new RecordingManager();
const scenarioManager = new ScenarioManager(vehicleManager, incidentManager, simulationController);
const geoFenceManager = new GeoFenceManager();

// ─── Route context shared by all route modules ──────────────────────

const ctx: RouteContext = {
  network,
  vehicleManager,
  fleetManager,
  incidentManager,
  recordingManager,
  simulationController,
  scenarioManager,
};

// ─── Health endpoint ─────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: Math.floor((Date.now() - serverStartTime) / 1000),
    subsystems: {
      roadNetwork: !!network,
      simulation: simulationController.getStatus().ready,
    },
  });
});

// ─── Register routes ─────────────────────────────────────────────────

app.use(createSimulationRoutes(ctx));
app.use(createVehicleRoutes(ctx));
app.use(createNetworkRoutes(ctx));
app.use(createIncidentRoutes(ctx));
app.use(createRecordingRoutes(ctx));
app.use(createReplayRoutes(ctx));
app.use(createFleetRoutes(ctx));
app.use(createAnalyticsRoutes(ctx));
app.use(createScenarioRoutes(ctx));
app.use(createGeofenceRoutes(geoFenceManager));

// ─── API documentation ──────────────────────────────────────────────

const specPath = path.resolve("openapi.yaml");
app.get("/api-docs.yaml", (_req, res) => {
  if (!fs.existsSync(specPath)) {
    res.status(404).json({ error: "OpenAPI spec not found" });
    return;
  }
  res.type("text/yaml").send(fs.readFileSync(specPath, "utf-8"));
});
app.use("/api-docs", apiReference({ url: "/api-docs.yaml" }));

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
  const { trafficBroadcastInterval, analyticsBroadcastInterval } = wireEvents({
    ...ctx,
    broadcaster,
    geoFenceManager,
  });

  registerGracefulShutdown({
    server,
    wss,
    broadcaster,
    simulationController,
    network,
    trafficBroadcastInterval,
    analyticsBroadcastInterval,
  });
}

main().catch((err) => {
  logger.error(`Failed to start server: ${err}`);
  process.exit(1);
});
