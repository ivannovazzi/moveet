import type { RoadNetwork } from "../modules/RoadNetwork";
import type { VehicleManager } from "../modules/VehicleManager";
import type { FleetManager } from "../modules/FleetManager";
import type { IncidentManager } from "../modules/IncidentManager";
import type { RecordingManager } from "../modules/RecordingManager";
import type { SimulationController } from "../modules/SimulationController";
import type { WebSocketBroadcaster } from "../modules/WebSocketBroadcaster";
import type { GeoFenceManager } from "../modules/GeoFenceManager";
import type { ScenarioManager } from "../modules/scenario";
import type { StateStore } from "../modules/StateStore";
import type { GenerationManager } from "../modules/GenerationManager";
import type { VehicleDTO, RecordingMetadata } from "../types";
import type {
  GeneratedRecording,
  VehicleDirection,
  Heatzone,
  IncidentDTO,
  IncidentClearedPayload,
  WaypointReachedPayload,
  RouteCompletedPayload,
  VehicleReroutedPayload,
} from "@moveet/shared-types";
import { config } from "../utils/config";
import logger from "../utils/logger";

export interface EventWiringContext {
  network: RoadNetwork;
  vehicleManager: VehicleManager;
  fleetManager: FleetManager;
  incidentManager: IncidentManager;
  recordingManager: RecordingManager;
  simulationController: SimulationController;
  broadcaster: WebSocketBroadcaster;
  geoFenceManager: GeoFenceManager;
  scenarioManager: ScenarioManager;
  generationManager: GenerationManager;
  /** Optional — only present when PERSISTENCE_ENABLED=true */
  stateStore?: StateStore;
}

/**
 * Wire all domain events to the WebSocket broadcaster and recording manager.
 *
 * Returns cleanup intervals that callers should clear on shutdown.
 */
export function wireEvents(ctx: EventWiringContext): {
  trafficBroadcastInterval: NodeJS.Timeout;
  analyticsBroadcastInterval: NodeJS.Timeout;
} {
  const {
    network,
    vehicleManager,
    fleetManager,
    incidentManager,
    recordingManager,
    simulationController,
    broadcaster,
    geoFenceManager,
    scenarioManager,
    generationManager,
    stateStore,
  } = ctx;

  // ─── Vehicle updates (batched by the broadcaster) ───────────────────
  // Accumulate per-tick vehicle updates and run geofence checks once per flush
  const vehicleBatch: Map<string, VehicleDTO> = new Map();

  vehicleManager.on("update", (data) => {
    broadcaster.queueVehicleUpdate(data);
    recordingManager.captureVehicleSnapshot([data]);
    vehicleBatch.set(data.id, data);
  });

  // ─── Geofence event → WS broadcaster ───────────────────────────────
  geoFenceManager.on("geofence:event", (event) => {
    broadcaster.broadcast("geofence:event", event);
  });

  // ─── Non-vehicle events (broadcast immediately) ─────────────────────
  network.on("heatzones", (data) => broadcaster.broadcast("heatzones", data));
  vehicleManager.on("direction", (data) => broadcaster.broadcast("direction", data));
  vehicleManager.on("waypoint:reached", (data) => broadcaster.broadcast("waypoint:reached", data));
  vehicleManager.on("route:completed", (data) => broadcaster.broadcast("route:completed", data));
  vehicleManager.on("options", (data) => broadcaster.broadcast("options", data));
  simulationController.on("updateStatus", (data) => broadcaster.broadcast("status", data));
  simulationController.on("reset", (data) => {
    // Discard the previous vehicle set so the spatial index does not retain
    // stale entries across resets (would otherwise grow unbounded).
    broadcaster.clearVehicles();
    broadcaster.broadcast("reset", data);
  });
  simulationController.on("clock", (clockState) => {
    broadcaster.broadcast("clock", clockState);
  });
  fleetManager.on("fleet:created", (data) => broadcaster.broadcast("fleet:created", data));
  fleetManager.on("fleet:deleted", (data) => broadcaster.broadcast("fleet:deleted", data));
  fleetManager.on("fleet:assigned", (data) => broadcaster.broadcast("fleet:assigned", data));
  incidentManager.on("incident:created", (data) => broadcaster.broadcast("incident:created", data));
  incidentManager.on("incident:cleared", (data) => broadcaster.broadcast("incident:cleared", data));
  vehicleManager.on("vehicle:rerouted", (data) => broadcaster.broadcast("vehicle:rerouted", data));

  // ─── Traffic congestion snapshot + geofence checks every 2 seconds ──
  const trafficBroadcastInterval = setInterval(() => {
    const traffic = vehicleManager.getTrafficSnapshot();
    broadcaster.broadcast("traffic", traffic);

    // Run geofence checks against the vehicles accumulated since last tick
    if (vehicleBatch.size > 0) {
      geoFenceManager.checkVehicles(Array.from(vehicleBatch.values()));
      vehicleBatch.clear();
    }
  }, 2000);

  // ─── Recording events ──────────────────────────────────────────────
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

  // ─── Recording metadata persistence ────────────────────────────────
  if (stateStore) {
    recordingManager.on("recording:stopped", (metadata: RecordingMetadata) => {
      try {
        stateStore.insertRecording(metadata);
      } catch (err) {
        logger.error(`Failed to persist recording metadata: ${err}`);
      }
    });
  }

  // ─── Headless generation events → stateStore + WS broadcaster ──────
  generationManager.on("generate:progress", (data) => {
    broadcaster.broadcast("generate:progress", data);
  });

  generationManager.on(
    "generate:complete",
    (payload: { jobId: string; metadata: RecordingMetadata }) => {
      const { jobId, metadata } = payload;

      // Persist metadata so the generated recording appears in /recordings, and
      // build the same row shape /recordings returns for the WS payload.
      let recording: GeneratedRecording = {
        filePath: metadata.filePath,
        duration: metadata.duration,
        eventCount: metadata.eventCount,
        fileSize: metadata.fileSize,
        vehicleCount: metadata.vehicleCount,
        startTime: metadata.startTime,
      };

      if (stateStore) {
        try {
          stateStore.insertRecording(metadata);
          const row = stateStore.getRecordingByPath(metadata.filePath);
          if (row) {
            recording = {
              id: row.id,
              filePath: row.file_path,
              duration: row.duration,
              eventCount: row.event_count,
              fileSize: row.file_size,
              vehicleCount: row.vehicle_count,
              startTime: row.start_time,
              createdAt: row.created_at,
            };
          }
        } catch (err) {
          logger.error(`Failed to persist generated recording metadata: ${err}`);
        }
      }

      broadcaster.broadcast("generate:complete", { jobId, recording });
    }
  );

  generationManager.on("generate:error", (data) => {
    broadcaster.broadcast("generate:error", data);
  });

  // ─── Replay events → WS broadcaster ────────────────────────────────
  simulationController.on("replayVehicle", (data) => {
    const payload = data as { vehicles?: VehicleDTO[] };
    if (payload.vehicles && Array.isArray(payload.vehicles)) {
      broadcaster.broadcast("vehicles", payload.vehicles);
    }
  });
  // Replay events carry recording-sourced data typed as `unknown` on the
  // controller; cast to the contract type for the matching channel.
  simulationController.on("replayDirection", (data) =>
    broadcaster.broadcast("direction", data as VehicleDirection)
  );
  simulationController.on("replayIncident:created", (data) =>
    broadcaster.broadcast("incident:created", data as IncidentDTO)
  );
  simulationController.on("replayIncident:cleared", (data) =>
    broadcaster.broadcast("incident:cleared", data as IncidentClearedPayload)
  );
  simulationController.on("replayHeatzones", (data) =>
    broadcaster.broadcast("heatzones", data as Heatzone[])
  );
  simulationController.on("replayWaypoint:reached", (data) =>
    broadcaster.broadcast("waypoint:reached", data as WaypointReachedPayload)
  );
  simulationController.on("replayRoute:completed", (data) =>
    broadcaster.broadcast("route:completed", data as RouteCompletedPayload)
  );
  simulationController.on("replayVehicle:rerouted", (data) =>
    broadcaster.broadcast("vehicle:rerouted", data as VehicleReroutedPayload)
  );
  simulationController.on("replay:status", (data) => broadcaster.broadcast("replay:status", data));

  // ─── Scenario events → WS broadcaster ─────────────────────────────
  scenarioManager.on("scenario:started", (data) => broadcaster.broadcast("scenario:started", data));
  scenarioManager.on("scenario:event", (data) => broadcaster.broadcast("scenario:event", data));
  scenarioManager.on("scenario:paused", (data) => broadcaster.broadcast("scenario:paused", data));
  scenarioManager.on("scenario:resumed", (data) => broadcaster.broadcast("scenario:resumed", data));
  scenarioManager.on("scenario:completed", (data) =>
    broadcaster.broadcast("scenario:completed", data)
  );
  scenarioManager.on("scenario:stopped", (data) => broadcaster.broadcast("scenario:stopped", data));

  // ─── Analytics snapshot broadcast ─────────────────────────────────
  // Validated/defaulted via the zod envSchema (config.analyticsInterval).
  const analyticsIntervalMs = config.analyticsInterval;

  const analyticsBroadcastInterval = setInterval(() => {
    const snapshot = vehicleManager.analytics.getSnapshot();
    const timestamp = Date.now();

    // Broadcast to connected WebSocket clients
    if (broadcaster.clientCount > 0) {
      broadcaster.broadcast("analytics", {
        ...snapshot,
        timestamp,
      });
    }

    // Persist analytics snapshot to SQLite history
    if (stateStore) {
      stateStore.insertAnalytics({ ...snapshot, timestamp });
    }
  }, analyticsIntervalMs);

  return { trafficBroadcastInterval, analyticsBroadcastInterval };
}
