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
  createWeatherRoutes,
  createBuildingRoutes,
  createMapRoutes,
  createMapBuildRoutes,
} from "./routes";
import { jsonBodyParser } from "./routes/speedProfiles";
import { SpeedProfileManager } from "./modules/speedprofiles/SpeedProfileManager";
import { WeatherManager } from "./modules/weather/WeatherManager";
import { createGeofenceRoutes } from "./routes/geofences";
import type { RouteContext } from "./routes";
import { metricsMiddleware } from "./middleware/metrics";
import { setupWebSocket, wireEvents, registerGracefulShutdown } from "./setup";
import { apiReference } from "@scalar/express-api-reference";
import { MapLibrary } from "./modules/maps/MapLibrary";
import { MapSwitcher } from "./modules/maps/MapSwitcher";
import { MapBuildManager } from "./modules/maps/MapBuildManager";
import { createForkRunner } from "./modules/maps/MapBuildRunner";
import { GeofabrikIndex } from "./modules/maps/GeofabrikIndex";
import { Geocoder } from "./modules/maps/Geocoder";
import { presetRegions } from "@moveet/network/regions";
import { OSM_SERVICES_USER_AGENT } from "./constants";

verifyConfig();
logConfig();

const app = express();
app.use(cors({ origin: true }));
app.use(compression());
// The speed-profile import takes a whole profile file; every other route (and
// that one too when speed profiles are disabled) keeps express's default limit.
app.use(jsonBodyParser(config.speedProfilesEnabled));

// Correlation ID and request logging middleware
app.use(correlationIdMiddleware);

// Record HTTP request duration into the Prometheus histogram
app.use(metricsMiddleware);

const serverStartTime = Date.now();

// ─── Domain modules ──────────────────────────────────────────────────

// The map library decides which network loads. On first start it imports the
// pre-library data/network.geojson (+ data/buildings/) when present, else the
// small bundled demo map, so the simulator always has something to run on.
const mapLibrary = new MapLibrary(config.mapsDir);
const initialMapId = mapLibrary.initialize({
  legacyNetworkPath: path.resolve("data/network.geojson"),
  legacyBuildingsDir: path.resolve("data/buildings"),
  bundledNetworkPath: path.resolve("assets/default-map/network.geojson"),
});
logger.info(`Active map: ${initialMapId}`);

const network = new RoadNetwork(mapLibrary.networkPath(initialMapId));
const fleetManager = new FleetManager();
const incidentManager = new IncidentManager();
const vehicleManager = new VehicleManager(network, fleetManager);
const simulationController = new SimulationController(vehicleManager, incidentManager);
const recordingManager = new RecordingManager();
// Headless generation runs on the active map unless the request names a file.
const generationManager = new GenerationManager(() =>
  mapLibrary.networkPath(mapSwitcher.getActiveId())
);
const geoFenceManager = new GeoFenceManager();
const jobManager = new JobManager(vehicleManager);

// ─── Weather (fleetsim-all-1ajn.5) ───────────────────────────────────

// Always constructed (state + manual override work regardless), but its live
// poll only runs when WEATHER_ENABLED — see WeatherManager's doc comment.
// Location defaults to the loaded network's bounding-box centre; WEATHER_LAT/
// WEATHER_LON override either coordinate independently.
const weatherBbox = network.getBoundingBox();
const weatherManager = new WeatherManager({
  enabled: config.weatherEnabled,
  pollIntervalMs: config.weatherPollIntervalMs,
  fetchTimeoutMs: config.weatherFetchTimeoutMs,
  lat: config.weatherLat ?? (weatherBbox.minLat + weatherBbox.maxLat) / 2,
  lon: config.weatherLon ?? (weatherBbox.minLon + weatherBbox.maxLon) / 2,
});
// Apply every live/override change to routing cost, estimateTo and movement
// (all read RoadNetwork.getWeatherFactor — see RoadNetwork.setWeatherFactor).
weatherManager.on("weather:changed", (state: { speedFactor: number }) => {
  network.setWeatherFactor(state.speedFactor);
});
weatherManager.start(); // no-op (no fetch) unless WEATHER_ENABLED

// After jobManager: scenarios can create jobs (`create_job` events), so the
// scenario layer needs the dispatch module it drives.
const scenarioManager = new ScenarioManager(
  vehicleManager,
  incidentManager,
  simulationController,
  jobManager,
  weatherManager
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
  // file merges on top, once per file content (see applySeedFile).
  if (stateStore) speedProfiles.loadFrom(stateStore);
  if (config.speedProfileSeedFile) {
    const content = fs.readFileSync(path.resolve(config.speedProfileSeedFile), "utf8");
    const { applied, result } = speedProfiles.applySeedFile(content, stateStore);
    if (applied) logger.info(result, `Seeded speed profiles from ${config.speedProfileSeedFile}`);
    else logger.info(`Speed profile seed ${config.speedProfileSeedFile} already applied; skipped`);
  }
}

// ─── Map library hot swap ───────────────────────────────────────────

const mapSwitcher = new MapSwitcher(
  {
    library: mapLibrary,
    network,
    simulationController,
    vehicleManager,
    geoFenceManager,
    scenarioManager,
    weatherManager,
    speedProfiles,
    stateStore,
    persistenceManager,
    adapterConfigured: !!config.adapterURL,
    weatherLat: config.weatherLat,
    weatherLon: config.weatherLon,
  },
  initialMapId
);
mapSwitcher.recordGraphStats(initialMapId, network);

// ─── Map builds (Geofabrik + osmium, in a child process) ─────────────

const geofabrikIndex = new GeofabrikIndex({
  cacheDir: config.mapBuildCacheDir,
  ttlMs: config.geofabrikIndexTtlHours * 3600_000,
  userAgent: OSM_SERVICES_USER_AGENT,
});
const geocoder = new Geocoder({
  baseUrl: config.nominatimUrl,
  userAgent: OSM_SERVICES_USER_AGENT,
});
const mapPresets = presetRegions();
const mapBuildManager = new MapBuildManager({
  library: mapLibrary,
  geofabrik: geofabrikIndex,
  presets: mapPresets,
  runner: createForkRunner(),
  cacheDir: config.mapBuildCacheDir,
  allowed: config.allowMapBuilds,
  maxAreaKm2: config.mapBuildMaxAreaKm2,
  diskQuotaBytes: config.mapBuildDiskQuotaMb * 1024 * 1024,
  maxQueued: config.mapBuildMaxQueued,
  activate: (id) => mapSwitcher.activate(id),
});

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
  weatherManager,
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
app.use(createWeatherRoutes(ctx));
app.use(createBuildingRoutes({ dir: () => mapSwitcher.activeBuildingsDir() }));
app.use(
  createMapBuildRoutes({
    builds: mapBuildManager,
    geofabrik: geofabrikIndex,
    geocoder,
    presets: mapPresets,
  })
);
app.use(createMapRoutes({ library: mapLibrary, switcher: mapSwitcher, builds: mapBuildManager }));

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

  const { wss, broadcaster } = setupWebSocket(server, {
    // Weather only broadcasts on change, so a new client gets the current state now.
    onClientConnected: (ws, b) => {
      b.sendTo(ws, "weather", weatherManager.state());
      // Lets a reconnecting client notice a map switch it missed.
      b.sendTo(ws, "map", mapSwitcher.statusPayload());
    },
  });
  mapSwitcher.on("map", (payload) => broadcaster.broadcast("map", payload));
  mapBuildManager.on("mapjob", (job) => broadcaster.broadcast("mapjob", job));
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
    weatherManager,
    mapBuildManager,
  });
}

main().catch((err) => {
  logger.error(`Failed to start server: ${err}`);
  process.exit(1);
});
