import type { Request, Response, NextFunction } from "express";
import express from "express";
import compression from "compression";
import cors from "cors";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";
import { RoadNetwork } from "./modules/RoadNetwork";
import { VehicleManager } from "./modules/VehicleManager";
import { FleetManager } from "./modules/FleetManager";
import { IncidentManager } from "./modules/IncidentManager";
import { RecordingManager } from "./modules/RecordingManager";
import { SimulationController } from "./modules/SimulationController";
import { WebSocketBroadcaster } from "./modules/WebSocketBroadcaster";
import type { IncidentType } from "./types";
import { config, verifyConfig } from "./utils/config";
import { HEAT_ZONE_DEFAULTS } from "./constants";
import { VEHICLE_PROFILES } from "./utils/vehicleProfiles";
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
const incidentManager = new IncidentManager();
const vehicleManager = new VehicleManager(network, fleetManager);
const simulationController = new SimulationController(vehicleManager, incidentManager);
const recordingManager = new RecordingManager();

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

app.get("/vehicle-types", (_req, res) => {
  res.json(VEHICLE_PROFILES);
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
    res.json({ status: "started", vehicleTypes: req.body.vehicleTypes ?? null });
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

// ─── Recording ──────────────────────────────────────────────────────

app.post(
  "/recording/start",
  expensiveRateLimiter.middleware(),
  asyncHandler(async (_req, res) => {
    if (recordingManager.isRecording()) {
      res.status(409).json({ error: "Recording already in progress" });
      return;
    }
    const options = simulationController.getOptions();
    const vehicleCount = simulationController.getVehicles().length;
    const filePath = recordingManager.startRecording(options, vehicleCount);
    res.json({ status: "recording", filePath });
  })
);

app.post(
  "/recording/stop",
  asyncHandler(async (_req, res) => {
    if (!recordingManager.isRecording()) {
      res.status(409).json({ error: "No recording in progress" });
      return;
    }
    const metadata = recordingManager.stopRecording();
    res.json(metadata);
  })
);

app.get(
  "/recordings",
  asyncHandler(async (_req, res) => {
    const dir = "recordings";
    if (!fs.existsSync(dir)) {
      res.json([]);
      return;
    }
    const files = fs.readdirSync(dir);
    const result = files.map((fileName) => {
      const stat = fs.statSync(path.join(dir, fileName));
      return {
        fileName,
        fileSize: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    });
    res.json(result);
  })
);

// ─── Replay ─────────────────────────────────────────────────────────

app.post(
  "/replay/start",
  expensiveRateLimiter.middleware(),
  asyncHandler(async (req, res) => {
    const { file, speed } = req.body;
    if (!file || typeof file !== "string") {
      res.status(400).json({ error: "file is required" });
      return;
    }
    const filePath = path.join("recordings", file);
    try {
      const header = await simulationController.startReplay(filePath, speed);
      res.json({ status: "replaying", header });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start replay";
      res.status(400).json({ error: message });
    }
  })
);

app.post(
  "/replay/pause",
  asyncHandler(async (_req, res) => {
    simulationController.pauseReplay();
    res.json({ status: "paused" });
  })
);

app.post(
  "/replay/resume",
  asyncHandler(async (_req, res) => {
    simulationController.resumeReplay();
    res.json({ status: "resumed" });
  })
);

app.post(
  "/replay/stop",
  asyncHandler(async (_req, res) => {
    simulationController.stopReplay();
    res.json({ status: "stopped" });
  })
);

app.post(
  "/replay/seek",
  asyncHandler(async (req, res) => {
    const { timestamp } = req.body;
    simulationController.seekReplay(timestamp);
    res.json({ status: "seeked", timestamp });
  })
);

app.post(
  "/replay/speed",
  asyncHandler(async (req, res) => {
    const { speed } = req.body;
    simulationController.setReplaySpeed(speed ?? 1);
    res.json({ status: "speed_changed", speed });
  })
);

app.get("/replay/status", (_req, res) => {
  try {
    res.json(simulationController.getReplayStatus());
  } catch (error) {
    logger.error(`Error in /replay/status: ${error}`);
    res.status(500).json({ error: "Failed to get replay status" });
  }
});

// ─── Incidents ──────────────────────────────────────────────────────

const VALID_INCIDENT_TYPES: IncidentType[] = ["accident", "closure", "construction"];

app.get("/incidents", (_req, res) => {
  try {
    const incidents = incidentManager.getActiveIncidents();
    res.json(incidents.map((i) => incidentManager.toDTO(i)));
  } catch (error) {
    logger.error(`Error in /incidents GET: ${error}`);
    res.status(500).json({ error: "Failed to get incidents" });
  }
});

app.post(
  "/incidents",
  expensiveRateLimiter.middleware(),
  asyncHandler(async (req, res) => {
    const { edgeIds, type, duration, severity } = req.body;

    const errors: string[] = [];

    if (
      !Array.isArray(edgeIds) ||
      edgeIds.length === 0 ||
      !edgeIds.every((id: unknown) => typeof id === "string")
    ) {
      errors.push("edgeIds must be a non-empty array of strings");
    }

    if (!VALID_INCIDENT_TYPES.includes(type)) {
      errors.push(`type must be one of: ${VALID_INCIDENT_TYPES.join(", ")}`);
    }

    if (typeof duration !== "number" || duration <= 0) {
      errors.push("duration must be a positive number");
    }

    if (severity !== undefined && (typeof severity !== "number" || severity < 0 || severity > 1)) {
      errors.push("severity must be a number between 0 and 1");
    }

    if (errors.length > 0) {
      res.status(400).json({ error: "Validation failed", details: errors });
      return;
    }

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

app.delete("/incidents/:id", (_req, res) => {
  const removed = incidentManager.removeIncident(_req.params.id);
  if (!removed) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }
  res.json({ status: "removed" });
});

app.post(
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

app.post(
  "/incidents/at-position",
  expensiveRateLimiter.middleware(),
  asyncHandler(async (req, res) => {
    const { lat, lng, type } = req.body;

    if (typeof lat !== "number" || typeof lng !== "number") {
      res.status(400).json({ error: "lat and lng are required numbers" });
      return;
    }
    if (!VALID_INCIDENT_TYPES.includes(type)) {
      res.status(400).json({ error: `type must be one of: ${VALID_INCIDENT_TYPES.join(", ")}` });
      return;
    }

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

// ─── Clock ──────────────────────────────────────────────────────────

app.get("/clock", (_req, res) => {
  try {
    res.json(simulationController.getClock().getState());
  } catch (error) {
    logger.error(`Error in /clock: ${error}`);
    res.status(500).json({ error: "Failed to get clock state" });
  }
});

app.post(
  "/clock",
  asyncHandler(async (req, res) => {
    const { speedMultiplier, setTime } = req.body as {
      speedMultiplier?: number;
      setTime?: string;
    };
    const clock = simulationController.getClock();
    if (speedMultiplier !== undefined) {
      if (typeof speedMultiplier !== "number" || speedMultiplier < 0) {
        res.status(400).json({ error: "speedMultiplier must be a non-negative number" });
        return;
      }
      clock.setSpeedMultiplier(speedMultiplier);
    }
    if (setTime !== undefined) {
      const t = new Date(setTime);
      if (isNaN(t.getTime())) {
        res.status(400).json({ error: "setTime must be a valid ISO date string" });
        return;
      }
      clock.setTime(t);
    }
    res.json(clock.getState());
  })
);

// ─── Traffic Profile ────────────────────────────────────────────────

app.get("/traffic", (_req, res) => {
  try {
    res.json(vehicleManager.getTrafficSnapshot());
  } catch (error) {
    logger.error(`Error in /traffic: ${error}`);
    res.status(500).json({ error: "Failed to get traffic data" });
  }
});

app.get("/traffic-profile", (_req, res) => {
  try {
    res.json(simulationController.getTrafficProfile());
  } catch (error) {
    logger.error(`Error in /traffic-profile: ${error}`);
    res.status(500).json({ error: "Failed to get traffic profile" });
  }
});

app.post(
  "/traffic-profile",
  asyncHandler(async (req, res) => {
    const profile = req.body as { name?: string; timeRanges?: unknown[] };
    if (!profile || typeof profile.name !== "string" || !Array.isArray(profile.timeRanges)) {
      res.status(400).json({ error: "Invalid traffic profile format" });
      return;
    }
    simulationController.setTrafficProfile(req.body);
    res.json(simulationController.getTrafficProfile());
  })
);

// ─── Fleets ─────────────────────────────────────────────────────────

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
    recordingManager.captureVehicleSnapshot([data]);
  });

  // Non-vehicle events are broadcast immediately
  network.on("heatzones", (data) => broadcaster.broadcast("heatzones", data));
  vehicleManager.on("direction", (data) => broadcaster.broadcast("direction", data));
  vehicleManager.on("waypoint:reached", (data) => broadcaster.broadcast("waypoint:reached", data));
  vehicleManager.on("route:completed", (data) => broadcaster.broadcast("route:completed", data));
  vehicleManager.on("options", (data) => broadcaster.broadcast("options", data));
  simulationController.on("updateStatus", (data) => broadcaster.broadcast("status", data));
  simulationController.on("reset", (data) => broadcaster.broadcast("reset", data));
  simulationController.on("clock", (clockState) => {
    broadcaster.broadcast("clock", clockState);
  });
  fleetManager.on("fleet:created", (data) => broadcaster.broadcast("fleet:created", data));
  fleetManager.on("fleet:deleted", (data) => broadcaster.broadcast("fleet:deleted", data));
  fleetManager.on("fleet:assigned", (data) => broadcaster.broadcast("fleet:assigned", data));
  incidentManager.on("incident:created", (data) => broadcaster.broadcast("incident:created", data));
  incidentManager.on("incident:cleared", (data) => broadcaster.broadcast("incident:cleared", data));
  vehicleManager.on("vehicle:rerouted", (data) => broadcaster.broadcast("vehicle:rerouted", data));

  // Broadcast per-edge traffic congestion snapshot every 2 seconds
  const trafficBroadcastInterval = setInterval(() => {
    const traffic = vehicleManager.getTrafficSnapshot();
    broadcaster.broadcast("traffic", traffic);
  }, 2000);

  // Wire discrete events to recording manager
  vehicleManager.on("direction", (data) => recordingManager.recordEvent("direction", data));
  vehicleManager.on("waypoint:reached", (data) => recordingManager.recordEvent("waypoint", data));
  vehicleManager.on("route:completed", (data) =>
    recordingManager.recordEvent("route:completed", data)
  );
  vehicleManager.on("vehicle:rerouted", (data) =>
    recordingManager.recordEvent("vehicle:rerouted", data)
  );
  network.on("heatzones", (data) => recordingManager.recordEvent("heatzone", data));
  incidentManager.on("incident:created", (data) =>
    recordingManager.recordEvent("incident", { action: "created", ...data })
  );
  incidentManager.on("incident:cleared", (data) =>
    recordingManager.recordEvent("incident", { action: "cleared", ...data })
  );

  // Wire replay events from SimulationController to WS broadcaster
  simulationController.on("replayVehicle", (data) => {
    // Replay vehicle events arrive as { vehicles: VehicleSnapshot[] }
    // Broadcast as "vehicles" batch type so the UI processes them correctly
    const payload = data as { vehicles?: unknown[] };
    if (payload.vehicles && Array.isArray(payload.vehicles)) {
      broadcaster.broadcast("vehicles", payload.vehicles);
    }
  });
  simulationController.on("replayDirection", (data) => broadcaster.broadcast("direction", data));
  simulationController.on("replayIncident:created", (data) =>
    broadcaster.broadcast("incident:created", data)
  );
  simulationController.on("replayIncident:cleared", (data) =>
    broadcaster.broadcast("incident:cleared", data)
  );
  simulationController.on("replayHeatzones", (data) => broadcaster.broadcast("heatzones", data));
  simulationController.on("replayWaypoint:reached", (data) =>
    broadcaster.broadcast("waypoint:reached", data)
  );
  simulationController.on("replayRoute:completed", (data) =>
    broadcaster.broadcast("route:completed", data)
  );
  simulationController.on("replayVehicle:rerouted", (data) =>
    broadcaster.broadcast("vehicle:rerouted", data)
  );
  simulationController.on("replayStatus", (data) => broadcaster.broadcast("replayStatus", data));

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
    clearInterval(trafficBroadcastInterval);
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
