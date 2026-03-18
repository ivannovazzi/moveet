import type { RoadNetwork } from "../modules/RoadNetwork";
import type { VehicleManager } from "../modules/VehicleManager";
import type { FleetManager } from "../modules/FleetManager";
import type { IncidentManager } from "../modules/IncidentManager";
import type { RecordingManager } from "../modules/RecordingManager";
import type { SimulationController } from "../modules/SimulationController";
import type { WebSocketBroadcaster } from "../modules/WebSocketBroadcaster";

export interface EventWiringContext {
  network: RoadNetwork;
  vehicleManager: VehicleManager;
  fleetManager: FleetManager;
  incidentManager: IncidentManager;
  recordingManager: RecordingManager;
  simulationController: SimulationController;
  broadcaster: WebSocketBroadcaster;
}

/** Default analytics broadcast interval in ms (5 seconds). */
const DEFAULT_ANALYTICS_INTERVAL_MS = 5000;

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
  } = ctx;

  // ─── Vehicle updates (batched by the broadcaster) ───────────────────
  vehicleManager.on("update", (data) => {
    broadcaster.queueVehicleUpdate(data);
    recordingManager.captureVehicleSnapshot([data]);
  });

  // ─── Non-vehicle events (broadcast immediately) ─────────────────────
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

  // ─── Traffic congestion snapshot every 2 seconds ────────────────────
  const trafficBroadcastInterval = setInterval(() => {
    const traffic = vehicleManager.getTrafficSnapshot();
    broadcaster.broadcast("traffic", traffic);
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

  // ─── Replay events → WS broadcaster ────────────────────────────────
  simulationController.on("replayVehicle", (data) => {
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

  // ─── Analytics snapshot broadcast ─────────────────────────────────
  const analyticsIntervalMs = process.env.ANALYTICS_INTERVAL
    ? parseInt(process.env.ANALYTICS_INTERVAL, 10)
    : DEFAULT_ANALYTICS_INTERVAL_MS;

  const analyticsBroadcastInterval = setInterval(() => {
    // Only send if clients are connected
    if (broadcaster.clientCount === 0) return;

    const { summary, fleets } = vehicleManager.analytics.getSnapshot();
    broadcaster.broadcast("analytics", {
      summary,
      fleets,
      timestamp: Date.now(),
    });
  }, analyticsIntervalMs);

  return { trafficBroadcastInterval, analyticsBroadcastInterval };
}
