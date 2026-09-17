import express from "express";
import compression from "compression";
import cors from "cors";
import path from "path";
import fs from "fs";
import { RoadNetwork } from "./modules/RoadNetwork";
import { VehicleManager } from "./modules/VehicleManager";
import { FleetManager } from "./modules/FleetManager";
import { JobManager } from "./modules/JobManager";
import { IncidentManager } from "./modules/IncidentManager";
import { RecordingManager } from "./modules/RecordingManager";
import { GenerationManager } from "./modules/GenerationManager";
import { SimulationController } from "./modules/SimulationController";
import { GeoFenceManager } from "./modules/GeoFenceManager";
import { ScenarioManager } from "./modules/scenario";
import { StateStore } from "./modules/StateStore";
import { PersistenceManager } from "./modules/PersistenceManager";
import { config, verifyConfig, logConfig } from "./utils/config";
import { correlationIdMiddleware } from "./middleware/correlationId";
import { errorHandler } from "./middleware/errorHandler";
import logger from "./utils/logger";
import {
  createVehicleRoutes,
  createSimulationRoutes,
  createNetworkRoutes,
  createIncidentRoutes,
  createRecordingRoutes,
  createReplayRoutes,
  createFleetRoutes,
  createJobRoutes,
  createFaultRoutes,
  createAnalyticsRoutes,
  createScenarioRoutes,
  createStateRoutes,
  createMetricsRoutes,
  createSpeedProfileRoutes,
} from "./routes";
import { SPEED_PROFILE_IMPORT_LIMIT, SPEED_PROFILE_IMPORT_PATH } from "./routes/speedProfiles";
import { SpeedProfileManager } from "./modules/speedprofiles/SpeedProfileManager";
import type { SpeedProfileFile } from "./modules/speedprofiles/SpeedProfileStore";
import { createGeofenceRoutes } from "./routes/geofences";
import type { RouteContext } from "./routes";
import { metricsMiddleware } from "./middleware/metrics";
import { setupWebSocket, wireEvents, registerGracefulShutdown } from "./setup";
import { apiReference } from "@scalar/express-api-reference";

verifyConfig();
logConfig();

const app = express();
app.use(cors({ origin: true }));
app.use(compression());
// The speed-profile import takes a whole profile file; every other route keeps
// express's default body limit.
const jsonBody = express.json();
const largeJsonBody = express.json({ limit: SPEED_PROFILE_IMPORT_LIMIT });
app.use((req, res, next) =>
  (req.path === SPEED_PROFILE_IMPORT_PATH ? largeJsonBody : jsonBody)(req, res, next)
);

// Correlation ID and request logging middleware
app.use(correlationIdMiddleware);

// Record HTTP request duration into the Prometheus histogram
app.use(metricsMiddleware);

const serverStartTime = Date.now();

// ─── Domain modules ──────────────────────────────────────────────────

const network = new RoadNetwork(config.geojsonPath);
const fleetManager = new FleetManager();
const incidentManager = new IncidentManager();
const vehicleManager = new VehicleManager(network, fleetManager);
const simulationController = new SimulationController(vehicleManager, incidentManager);
const recordingManager = new RecordingManager();
const generationManager = new GenerationManager();
const geoFenceManager = new GeoFenceManager();
const jobManager = new JobManager(vehicleManager);
// After jobManager: scenarios can create jobs (`create_job` events), so the
// scenario layer needs the dispatch module it drives.
const scenarioManager = new ScenarioManager(
  vehicleManager,
  incidentManager,
  simulationController,
  jobManager
);

// ─── Learned speed profiles (optional) ──────────────────────────────

// Off by default (SPEED_PROFILES_ENABLED): routing is then byte-for-byte the
// static model, and the network was built without the learned-speed landmark
// bound. When on, the simulated clock picks the active time bucket.
let speedProfiles: SpeedProfileManager | undefined;
if (config.speedProfilesEnabled) {
  speedProfiles = new SpeedProfileManager(
    network,
    {
      sources: config.speedProfileSources,
      layout: { period: config.speedProfilePeriod, bucketHours: config.speedProfileBucketHours },
      minSamples: config.speedProfileMinSamples,
      alpha: config.speedProfileEwmaAlpha,
      publishIntervalMs: config.speedProfilePublishIntervalMs,
    },
    () => vehicleManager.clock.now()
  );
  speedProfiles.install();
  vehicleManager.routeManager.setTraversalRecorder(speedProfiles.recorder);
}

// ─── Persistence (optional) ─────────────────────────────────────────

let persistenceManager: PersistenceManager | undefined;
let stateStore: StateStore | undefined;

if (config.persistenceEnabled) {
  stateStore = new StateStore(config.stateDbPath);
  persistenceManager = new PersistenceManager({
    stateStore,
    vehicleManager,
    fleetManager,
    geoFenceManager,
    incidentManager,
    speedProfiles,
  });
}

if (speedProfiles) {
  // Learned profiles are accumulated knowledge rather than run state, so they
  // load whenever persistence is on (independent of RESTORE_STATE); a seed
  // file merges on top.
  if (stateStore) speedProfiles.loadFrom(stateStore);
  if (config.speedProfileSeedFile) {
    const seed = JSON.parse(
      fs.readFileSync(path.resolve(config.speedProfileSeedFile), "utf8")
    ) as SpeedProfileFile;
    const result = speedProfiles.importFile(seed, "merge");
    logger.info(result, `Seeded speed profiles from ${config.speedProfileSeedFile}`);
  }
}

// ─── Route context shared by all route modules ──────────────────────

const ctx: RouteContext = {
  network,
  vehicleManager,
  fleetManager,
  jobManager,
  incidentManager,
  recordingManager,
  simulationController,
  scenarioManager,
  generationManager,
  stateStore,
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
    // true when adapter integration is disabled, or its most recent sync
    // attempt succeeded; false only when configured and the last attempt failed.
    adapterConnected: vehicleManager.adapterSync.isConnected(),
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
app.use(createJobRoutes(ctx));
app.use(createFaultRoutes(ctx));
app.use(createAnalyticsRoutes(ctx));
app.use(createScenarioRoutes(ctx));
app.use(createGeofenceRoutes(geoFenceManager));
app.use(createMetricsRoutes());
if (persistenceManager) {
  app.use(createStateRoutes(persistenceManager));
}
if (speedProfiles) {
  app.use(createSpeedProfileRoutes(speedProfiles));
}

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
app.use(errorHandler);

// ─── Server startup ──────────────────────────────────────────────────

async function main() {
  await vehicleManager.initFromAdapter();

  // Restore persisted state before marking ready
  if (persistenceManager && config.restoreState) {
    const restored = persistenceManager.restore();
    if (restored) {
      logger.info("Simulation state restored from snapshot");
    }
  }

  simulationController.markReady();

  const server = app.listen(config.port, () => {
    logger.info(`Server started on port ${config.port}`);
  });

  const { wss, broadcaster } = setupWebSocket(server);
  const {
    trafficBroadcastInterval,
    analyticsBroadcastInterval,
    recordingBatchInterval,
    flushRecordingBatch,
  } = wireEvents({
    ...ctx,
    broadcaster,
    geoFenceManager,
    stateStore,
  });

  // Start persistence auto-save after all wiring is done
  if (persistenceManager) {
    persistenceManager.startAutoSave(config.persistenceInterval * 1000);
  }

  registerGracefulShutdown({
    server,
    wss,
    broadcaster,
    simulationController,
    vehicleManager,
    network,
    trafficBroadcastInterval,
    analyticsBroadcastInterval,
    recordingBatchInterval,
    flushRecordingBatch,
    recordingManager,
    persistenceManager,
  });
}

main().catch((err) => {
  logger.error(`Failed to start server: ${err}`);
  process.exit(1);
});
