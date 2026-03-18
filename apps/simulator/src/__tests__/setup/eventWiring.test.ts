import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { wireEvents } from "../../setup/eventWiring";
import type { EventWiringContext } from "../../setup/eventWiring";
import { GeoFenceManager } from "../../modules/GeoFenceManager";

function createMockEmitter() {
  return new EventEmitter();
}

function createMockBroadcaster() {
  return {
    queueVehicleUpdate: vi.fn(),
    broadcast: vi.fn(),
  } as unknown as EventWiringContext["broadcaster"];
}

function createMockRecordingManager() {
  const emitter = createMockEmitter();
  return Object.assign(emitter, {
    captureVehicleSnapshot: vi.fn(),
    recordEvent: vi.fn(),
  }) as unknown as EventWiringContext["recordingManager"];
}

describe("wireEvents", () => {
  let network: EventEmitter;
  let vehicleManager: EventEmitter;
  let fleetManager: EventEmitter;
  let incidentManager: EventEmitter;
  let simulationController: EventEmitter;
  let broadcaster: ReturnType<typeof createMockBroadcaster>;
  let recordingManager: ReturnType<typeof createMockRecordingManager>;
  let geoFenceManager: GeoFenceManager;
  let result: { trafficBroadcastInterval: NodeJS.Timeout; analyticsBroadcastInterval: NodeJS.Timeout };

  beforeEach(() => {
    network = createMockEmitter();
    vehicleManager = createMockEmitter();
    fleetManager = createMockEmitter();
    incidentManager = createMockEmitter();
    simulationController = createMockEmitter();
    broadcaster = createMockBroadcaster();
    recordingManager = createMockRecordingManager();
    geoFenceManager = new GeoFenceManager();

    const ctx: EventWiringContext = {
      network: network as unknown as EventWiringContext["network"],
      vehicleManager: Object.assign(vehicleManager, {
        getTrafficSnapshot: vi.fn().mockReturnValue({ edges: {} }),
      }) as unknown as EventWiringContext["vehicleManager"],
      fleetManager: fleetManager as unknown as EventWiringContext["fleetManager"],
      incidentManager: incidentManager as unknown as EventWiringContext["incidentManager"],
      recordingManager: recordingManager as unknown as EventWiringContext["recordingManager"],
      simulationController:
        simulationController as unknown as EventWiringContext["simulationController"],
      broadcaster,
      geoFenceManager,
    };

    result = wireEvents(ctx);
  });

  afterEach(() => {
    clearInterval(result.trafficBroadcastInterval);
    clearInterval(result.analyticsBroadcastInterval);
  });

  it("should return a traffic broadcast interval", () => {
    expect(result.trafficBroadcastInterval).toBeDefined();
  });

  // ─── Vehicle events ─────────────────────────────────────────────────

  describe("vehicle update events", () => {
    it("should queue vehicle updates to broadcaster", () => {
      const data = { id: "v1", position: [0, 0] };
      vehicleManager.emit("update", data);
      expect(broadcaster.queueVehicleUpdate).toHaveBeenCalledWith(data);
    });

    it("should capture vehicle snapshots for recording", () => {
      const data = { id: "v1", position: [0, 0] };
      vehicleManager.emit("update", data);
      expect(recordingManager.captureVehicleSnapshot).toHaveBeenCalledWith([data]);
    });
  });

  describe("vehicle direction events", () => {
    it("should broadcast direction events", () => {
      const data = { vehicleId: "v1", route: {} };
      vehicleManager.emit("direction", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("direction", data);
    });

    it("should record direction events", () => {
      const data = { vehicleId: "v1", route: {} };
      vehicleManager.emit("direction", data);
      expect(recordingManager.recordEvent).toHaveBeenCalledWith("direction", data);
    });
  });

  describe("vehicle waypoint events", () => {
    it("should broadcast waypoint:reached events", () => {
      const data = { vehicleId: "v1", waypointIndex: 0 };
      vehicleManager.emit("waypoint:reached", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("waypoint:reached", data);
    });

    it("should record waypoint events", () => {
      const data = { vehicleId: "v1", waypointIndex: 0 };
      vehicleManager.emit("waypoint:reached", data);
      expect(recordingManager.recordEvent).toHaveBeenCalledWith("waypoint", data);
    });
  });

  describe("vehicle route:completed events", () => {
    it("should broadcast route:completed events", () => {
      const data = { vehicleId: "v1" };
      vehicleManager.emit("route:completed", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("route:completed", data);
    });

    it("should record route:completed events", () => {
      const data = { vehicleId: "v1" };
      vehicleManager.emit("route:completed", data);
      expect(recordingManager.recordEvent).toHaveBeenCalledWith("route:completed", data);
    });
  });

  describe("vehicle options events", () => {
    it("should broadcast options events", () => {
      const data = { minSpeed: 20 };
      vehicleManager.emit("options", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("options", data);
    });
  });

  describe("vehicle:rerouted events", () => {
    it("should broadcast vehicle:rerouted events", () => {
      const data = { vehicleId: "v1" };
      vehicleManager.emit("vehicle:rerouted", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("vehicle:rerouted", data);
    });

    it("should record vehicle:rerouted events", () => {
      const data = { vehicleId: "v1" };
      vehicleManager.emit("vehicle:rerouted", data);
      expect(recordingManager.recordEvent).toHaveBeenCalledWith("vehicle:rerouted", data);
    });
  });

  // ─── Network events ─────────────────────────────────────────────────

  describe("network heatzone events", () => {
    it("should broadcast heatzones events", () => {
      const data = [{ id: "hz1" }];
      network.emit("heatzones", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("heatzones", data);
    });

    it("should record heatzone events", () => {
      const data = [{ id: "hz1" }];
      network.emit("heatzones", data);
      expect(recordingManager.recordEvent).toHaveBeenCalledWith("heatzone", data);
    });
  });

  // ─── Simulation controller events ───────────────────────────────────

  describe("simulation controller events", () => {
    it("should broadcast status updates", () => {
      const data = { running: true, ready: true };
      simulationController.emit("updateStatus", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("status", data);
    });

    it("should broadcast reset events", () => {
      const data = { vehicles: [], directions: [] };
      simulationController.emit("reset", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("reset", data);
    });

    it("should broadcast clock events", () => {
      const data = { currentTime: "2026-01-01", hour: 12 };
      simulationController.emit("clock", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("clock", data);
    });
  });

  // ─── Fleet events ──────────────────────────────────────────────────

  describe("fleet events", () => {
    it("should broadcast fleet:created events", () => {
      const data = { id: "f1", name: "Fleet A" };
      fleetManager.emit("fleet:created", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("fleet:created", data);
    });

    it("should broadcast fleet:deleted events", () => {
      const data = { id: "f1" };
      fleetManager.emit("fleet:deleted", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("fleet:deleted", data);
    });

    it("should broadcast fleet:assigned events", () => {
      const data = { id: "f1", vehicleIds: ["v1"] };
      fleetManager.emit("fleet:assigned", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("fleet:assigned", data);
    });
  });

  // ─── Incident events ──────────────────────────────────────────────

  describe("incident events", () => {
    it("should broadcast incident:created events", () => {
      const data = { id: "inc1", type: "accident" };
      incidentManager.emit("incident:created", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("incident:created", data);
    });

    it("should record incident:created events with action", () => {
      const data = { id: "inc1", type: "accident" };
      incidentManager.emit("incident:created", data);
      expect(recordingManager.recordEvent).toHaveBeenCalledWith("incident", {
        action: "created",
        ...data,
      });
    });

    it("should broadcast incident:cleared events", () => {
      const data = { id: "inc1" };
      incidentManager.emit("incident:cleared", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("incident:cleared", data);
    });

    it("should record incident:cleared events with action", () => {
      const data = { id: "inc1" };
      incidentManager.emit("incident:cleared", data);
      expect(recordingManager.recordEvent).toHaveBeenCalledWith("incident", {
        action: "cleared",
        ...data,
      });
    });
  });

  // ─── Replay events ────────────────────────────────────────────────

  describe("replay events", () => {
    it("should broadcast replay vehicle events as batch", () => {
      const data = { vehicles: [{ id: "v1" }, { id: "v2" }] };
      simulationController.emit("replayVehicle", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("vehicles", data.vehicles);
    });

    it("should not broadcast replay vehicle events without vehicles array", () => {
      simulationController.emit("replayVehicle", {});
      expect(broadcaster.broadcast).not.toHaveBeenCalledWith("vehicles", expect.anything());
    });

    it("should broadcast replay direction events", () => {
      const data = { vehicleId: "v1" };
      simulationController.emit("replayDirection", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("direction", data);
    });

    it("should broadcast replay incident:created events", () => {
      const data = { id: "inc1" };
      simulationController.emit("replayIncident:created", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("incident:created", data);
    });

    it("should broadcast replay incident:cleared events", () => {
      const data = { id: "inc1" };
      simulationController.emit("replayIncident:cleared", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("incident:cleared", data);
    });

    it("should broadcast replay heatzones events", () => {
      const data = [{ id: "hz1" }];
      simulationController.emit("replayHeatzones", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("heatzones", data);
    });

    it("should broadcast replay waypoint:reached events", () => {
      const data = { vehicleId: "v1" };
      simulationController.emit("replayWaypoint:reached", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("waypoint:reached", data);
    });

    it("should broadcast replay route:completed events", () => {
      const data = { vehicleId: "v1" };
      simulationController.emit("replayRoute:completed", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("route:completed", data);
    });

    it("should broadcast replay vehicle:rerouted events", () => {
      const data = { vehicleId: "v1" };
      simulationController.emit("replayVehicle:rerouted", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("vehicle:rerouted", data);
    });

    it("should broadcast replay status events", () => {
      const data = { mode: "replay", progress: 0.5 };
      simulationController.emit("replayStatus", data);
      expect(broadcaster.broadcast).toHaveBeenCalledWith("replayStatus", data);
    });
  });
});
