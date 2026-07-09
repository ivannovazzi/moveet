import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StartOptions, SimulationStatus, VehicleDTO, Heatzone, Position } from "@/types";
import type { VehicleDirection as Direction } from "@/types";

const { mockHttp, mockWs } = vi.hoisted(() => ({
  mockHttp: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  mockWs: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock("./httpClient", () => ({
  HttpClient: function () {
    return mockHttp;
  },
}));

vi.mock("./wsClient", () => ({
  WebSocketClient: function () {
    return mockWs;
  },
}));

// Import after mocks are set up -- the singleton will be built with mock deps
import service from "./client";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SimulationService", () => {
  // ─── WebSocket delegation ──────────────────────────────────────

  describe("connectWebSocket", () => {
    it("delegates to ws.connect()", () => {
      service.connectWebSocket();
      expect(mockWs.connect).toHaveBeenCalledOnce();
    });
  });

  describe("disconnect", () => {
    it("delegates to ws.disconnect()", () => {
      service.disconnect();
      expect(mockWs.disconnect).toHaveBeenCalledOnce();
    });
  });

  // ─── Event subscription methods ────────────────────────────────

  describe("onConnect", () => {
    it("registers a 'connect' handler on the ws client", () => {
      const handler = vi.fn();
      service.onConnect(handler);
      expect(mockWs.on).toHaveBeenCalledWith("connect", expect.any(Function));
    });

    it("wraps the handler so it is called with no arguments", () => {
      const handler = vi.fn();
      service.onConnect(handler);

      // Retrieve the wrapper passed to ws.on and invoke it
      const wrapper = mockWs.on.mock.calls.find((c: string[]) => c[0] === "connect")![1];
      wrapper();
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe("onDisconnect", () => {
    it("registers a 'disconnect' handler on the ws client", () => {
      const handler = vi.fn();
      service.onDisconnect(handler);
      expect(mockWs.on).toHaveBeenCalledWith("disconnect", expect.any(Function));
    });

    it("wraps the handler so it is called with no arguments", () => {
      const handler = vi.fn();
      service.onDisconnect(handler);

      const wrapper = mockWs.on.mock.calls.find((c: string[]) => c[0] === "disconnect")![1];
      wrapper();
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe("onVehicle", () => {
    const validVehicle: VehicleDTO = {
      id: "v1",
      name: "Vehicle 1",
      type: "car",
      position: [1, 2],
      speed: 10,
      heading: 90,
    };

    it("registers a validating 'vehicle' handler on the ws client", () => {
      const handler = vi.fn<(v: VehicleDTO) => void>();
      service.onVehicle(handler);
      expect(mockWs.on).toHaveBeenCalledWith("vehicle", expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith("vehicles", expect.any(Function));
    });

    it("passes through vehicles with finite position/speed/heading", () => {
      const handler = vi.fn<(v: VehicleDTO) => void>();
      service.onVehicle(handler);
      const wrapper = mockWs.on.mock.calls.find((c: string[]) => c[0] === "vehicle")![1];
      wrapper(validVehicle);
      expect(handler).toHaveBeenCalledWith(validVehicle);
    });

    it("drops vehicles with non-finite position/speed/heading", () => {
      const handler = vi.fn<(v: VehicleDTO) => void>();
      service.onVehicle(handler);
      const wrapper = mockWs.on.mock.calls.find((c: string[]) => c[0] === "vehicle")![1];
      wrapper({ ...validVehicle, position: [NaN, 2] });
      wrapper({ ...validVehicle, speed: Infinity });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("onStatus", () => {
    it("registers the handler directly for 'status' events", () => {
      const handler = vi.fn<(s: SimulationStatus) => void>();
      service.onStatus(handler);
      expect(mockWs.on).toHaveBeenCalledWith("status", handler);
    });
  });

  describe("onOptions", () => {
    it("registers the handler directly for 'options' events", () => {
      const handler = vi.fn<(o: StartOptions) => void>();
      service.onOptions(handler);
      expect(mockWs.on).toHaveBeenCalledWith("options", handler);
    });
  });

  describe("onHeatzones", () => {
    it("registers the handler directly for 'heatzones' events", () => {
      const handler = vi.fn<(h: Heatzone[]) => void>();
      service.onHeatzones(handler);
      expect(mockWs.on).toHaveBeenCalledWith("heatzones", handler);
    });
  });

  describe("onDirection", () => {
    it("registers the handler directly for 'direction' events", () => {
      const handler = vi.fn<(d: Direction) => void>();
      service.onDirection(handler);
      expect(mockWs.on).toHaveBeenCalledWith("direction", handler);
    });
  });

  // ─── HTTP POST methods ─────────────────────────────────────────

  describe("start", () => {
    it("posts options to /start", async () => {
      const options = { minSpeed: 5 } as StartOptions;
      const response = { data: undefined };
      mockHttp.post.mockResolvedValue(response);

      const result = await service.start(options);

      expect(mockHttp.post).toHaveBeenCalledWith("/start", options);
      expect(result).toBe(response);
    });
  });

  describe("stop", () => {
    it("posts to /stop with no body", async () => {
      const response = { data: undefined };
      mockHttp.post.mockResolvedValue(response);

      const result = await service.stop();

      expect(mockHttp.post).toHaveBeenCalledWith("/stop");
      expect(result).toBe(response);
    });
  });

  describe("reset", () => {
    it("posts to /reset with no body", async () => {
      const response = { data: undefined };
      mockHttp.post.mockResolvedValue(response);

      const result = await service.reset();

      expect(mockHttp.post).toHaveBeenCalledWith("/reset");
      expect(result).toBe(response);
    });
  });

  describe("direction", () => {
    it("maps vehicle ids and position into the expected body shape", async () => {
      const response = { data: undefined };
      mockHttp.post.mockResolvedValue(response);

      const ids = ["v1", "v2"];
      const position: Position = [36.8, -1.3]; // [lng, lat]

      const result = await service.direction(ids, position);

      expect(mockHttp.post).toHaveBeenCalledWith("/direction", [
        { id: "v1", lat: -1.3, lng: 36.8 },
        { id: "v2", lat: -1.3, lng: 36.8 },
      ]);
      expect(result).toBe(response);
    });

    it("sends an empty array when no ids are provided", async () => {
      mockHttp.post.mockResolvedValue({ data: undefined });

      await service.direction([], [0, 0]);

      expect(mockHttp.post).toHaveBeenCalledWith("/direction", []);
    });
  });

  describe("updateOptions", () => {
    it("posts options to /options", async () => {
      const options = { minSpeed: 10 } as StartOptions;
      const response = { data: undefined };
      mockHttp.post.mockResolvedValue(response);

      const result = await service.updateOptions(options);

      expect(mockHttp.post).toHaveBeenCalledWith("/options", options);
      expect(result).toBe(response);
    });
  });

  describe("createHeatzone", () => {
    it("posts geometry + intensity to /heatzones", async () => {
      const body = {
        geometry: {
          type: "Polygon" as const,
          coordinates: [
            [36.8, -1.3],
            [36.81, -1.3],
            [36.81, -1.31],
            [36.8, -1.3],
          ] as Position[],
        },
        intensity: 0.6,
      };
      const response = { data: undefined };
      mockHttp.post.mockResolvedValue(response);

      const result = await service.createHeatzone(body);

      expect(mockHttp.post).toHaveBeenCalledWith("/heatzones", body);
      expect(result).toBe(response);
    });
  });

  describe("updateHeatzone", () => {
    it("patches the body to /heatzones/:id", async () => {
      const response = { data: undefined };
      mockHttp.patch.mockResolvedValue(response);

      const result = await service.updateHeatzone("hz-1", { intensity: 0.9 });

      expect(mockHttp.patch).toHaveBeenCalledWith("/heatzones/hz-1", { intensity: 0.9 });
      expect(result).toBe(response);
    });
  });

  describe("deleteHeatzone", () => {
    it("deletes /heatzones/:id", async () => {
      const response = { data: undefined };
      mockHttp.delete.mockResolvedValue(response);

      const result = await service.deleteHeatzone("hz-1");

      expect(mockHttp.delete).toHaveBeenCalledWith("/heatzones/hz-1");
      expect(result).toBe(response);
    });
  });

  describe("clearHeatzones", () => {
    it("deletes /heatzones", async () => {
      const response = { data: undefined };
      mockHttp.delete.mockResolvedValue(response);

      const result = await service.clearHeatzones();

      expect(mockHttp.delete).toHaveBeenCalledWith("/heatzones");
      expect(result).toBe(response);
    });
  });

  describe("seedHeatzones", () => {
    it("posts the count to /heatzones/seed", async () => {
      const response = { data: [] };
      mockHttp.post.mockResolvedValue(response);

      const result = await service.seedHeatzones({ count: 5 });

      expect(mockHttp.post).toHaveBeenCalledWith("/heatzones/seed", { count: 5 });
      expect(result).toBe(response);
    });

    it("defaults to an empty body when no count is given", async () => {
      mockHttp.post.mockResolvedValue({ data: [] });

      await service.seedHeatzones();

      expect(mockHttp.post).toHaveBeenCalledWith("/heatzones/seed", {});
    });
  });

  describe("findRoad", () => {
    it("posts position to /find-road", async () => {
      const position: Position = [36.8, -1.3];
      const response = { data: { name: "Ngong Rd" } };
      mockHttp.post.mockResolvedValue(response);

      const result = await service.findRoad(position);

      expect(mockHttp.post).toHaveBeenCalledWith("/find-road", position);
      expect(result).toBe(response);
    });
  });

  describe("findNode", () => {
    it("posts position to /find-node", async () => {
      const position: Position = [36.8, -1.3];
      const response = { data: [36.81, -1.31] };
      mockHttp.post.mockResolvedValue(response);

      const result = await service.findNode(position);

      expect(mockHttp.post).toHaveBeenCalledWith("/find-node", position);
      expect(result).toBe(response);
    });
  });

  describe("search", () => {
    it("posts query wrapped in an object to /search", async () => {
      const response = { data: [{ name: "Some Road" }] };
      mockHttp.post.mockResolvedValue(response);

      const result = await service.search("Ngong");

      expect(mockHttp.post).toHaveBeenCalledWith("/search", { query: "Ngong" });
      expect(result).toBe(response);
    });
  });

  // ─── HTTP GET methods ──────────────────────────────────────────

  describe("getStatus", () => {
    it("gets /status", async () => {
      const response = { data: { running: true, interval: 100 } };
      mockHttp.get.mockResolvedValue(response);

      const result = await service.getStatus();

      expect(mockHttp.get).toHaveBeenCalledWith("/status");
      expect(result).toBe(response);
    });
  });

  describe("getVehicles", () => {
    it("gets /vehicles", async () => {
      const response = { data: [] };
      mockHttp.get.mockResolvedValue(response);

      const result = await service.getVehicles();

      expect(mockHttp.get).toHaveBeenCalledWith("/vehicles");
      expect(result).toBe(response);
    });
  });

  describe("getNetwork", () => {
    it("gets /network", async () => {
      const response = { data: { type: "FeatureCollection", features: [] } };
      mockHttp.get.mockResolvedValue(response);

      const result = await service.getNetwork();

      expect(mockHttp.get).toHaveBeenCalledWith("/network");
      expect(result).toBe(response);
    });
  });

  describe("getRoads", () => {
    it("gets /roads", async () => {
      const response = { data: [] };
      mockHttp.get.mockResolvedValue(response);

      const result = await service.getRoads();

      expect(mockHttp.get).toHaveBeenCalledWith("/roads");
      expect(result).toBe(response);
    });
  });

  describe("getPois", () => {
    it("gets /pois", async () => {
      const response = { data: [] };
      mockHttp.get.mockResolvedValue(response);

      const result = await service.getPois();

      expect(mockHttp.get).toHaveBeenCalledWith("/pois");
      expect(result).toBe(response);
    });
  });

  describe("getOptions", () => {
    it("gets /options", async () => {
      const response = { data: { minSpeed: 5 } };
      mockHttp.get.mockResolvedValue(response);

      const result = await service.getOptions();

      expect(mockHttp.get).toHaveBeenCalledWith("/options");
      expect(result).toBe(response);
    });
  });

  describe("getDirections", () => {
    it("gets /directions", async () => {
      const response = { data: [] };
      mockHttp.get.mockResolvedValue(response);

      const result = await service.getDirections();

      expect(mockHttp.get).toHaveBeenCalledWith("/directions");
      expect(result).toBe(response);
    });
  });

  describe("getHeatzones", () => {
    it("gets /heatzones", async () => {
      const response = { data: [] };
      mockHttp.get.mockResolvedValue(response);

      const result = await service.getHeatzones();

      expect(mockHttp.get).toHaveBeenCalledWith("/heatzones");
      expect(result).toBe(response);
    });
  });

  // ─── Historical generation ─────────────────────────────────────

  describe("generateRecording", () => {
    it("posts the body to /recording/generate", async () => {
      const body = {
        startTime: "2026-05-25T00:00:00.000Z",
        hours: 24,
        vehicleCount: 20,
        stepMs: 1000,
        seed: 42,
      };
      const response = { data: { status: "generating", jobId: "j1" } };
      mockHttp.post.mockResolvedValue(response);

      const result = await service.generateRecording(body);

      expect(mockHttp.post).toHaveBeenCalledWith("/recording/generate", body);
      expect(result).toBe(response);
    });
  });

  describe("getGenerateStatus", () => {
    it("gets /recording/generate/status", async () => {
      const response = { data: { state: "idle" } };
      mockHttp.get.mockResolvedValue(response);

      const result = await service.getGenerateStatus();

      expect(mockHttp.get).toHaveBeenCalledWith("/recording/generate/status");
      expect(result).toBe(response);
    });
  });

  describe("onGenerateProgress / onGenerateComplete / onGenerateError", () => {
    it("registers handlers on the matching ws event names", () => {
      const onProgress = vi.fn();
      const onComplete = vi.fn();
      const onError = vi.fn();

      service.onGenerateProgress(onProgress);
      service.onGenerateComplete(onComplete);
      service.onGenerateError(onError);

      expect(mockWs.on).toHaveBeenCalledWith("generate:progress", onProgress);
      expect(mockWs.on).toHaveBeenCalledWith("generate:complete", onComplete);
      expect(mockWs.on).toHaveBeenCalledWith("generate:error", onError);
    });

    it("unsubscribes via the off* helpers", () => {
      const onProgress = vi.fn();
      service.offGenerateProgress(onProgress);
      service.offGenerateComplete();
      service.offGenerateError();

      expect(mockWs.off).toHaveBeenCalledWith("generate:progress", onProgress);
      expect(mockWs.off).toHaveBeenCalledWith("generate:complete", undefined);
      expect(mockWs.off).toHaveBeenCalledWith("generate:error", undefined);
    });
  });

  // ─── Bound methods ────────────────────────────────────────────

  describe("method binding", () => {
    it("methods work correctly when destructured (bound in constructor)", async () => {
      mockHttp.post.mockResolvedValue({ data: undefined });
      mockHttp.get.mockResolvedValue({ data: [] });

      const { stop, start, reset, getStatus, connectWebSocket, disconnect, onVehicle } = service;

      // These should not throw even though they are detached from `this`
      connectWebSocket();
      expect(mockWs.connect).toHaveBeenCalled();

      disconnect();
      expect(mockWs.disconnect).toHaveBeenCalled();

      const handler = vi.fn();
      onVehicle(handler);
      // onVehicle wraps the caller's handler in a finite-number validation
      // guard, so the registered listener is the wrapper, not `handler` itself.
      expect(mockWs.on).toHaveBeenCalledWith("vehicle", expect.any(Function));

      await stop();
      expect(mockHttp.post).toHaveBeenCalledWith("/stop");

      await start({ minSpeed: 5 } as StartOptions);
      expect(mockHttp.post).toHaveBeenCalledWith("/start", { minSpeed: 5 });

      await reset();
      expect(mockHttp.post).toHaveBeenCalledWith("/reset");

      await getStatus();
      expect(mockHttp.get).toHaveBeenCalledWith("/status");
    });
  });

  // ─── Public surface (post-decomposition) ───────────────────────
  // The transport is split into domain segment modules behind a thin
  // facade. This guards the facade against silently dropping or renaming a
  // method when segments are added/moved. Every name below must remain a
  // callable on the singleton.
  describe("public API surface", () => {
    const EXPECTED_METHODS = [
      // connection / core channels
      "connectWebSocket",
      "retryConnection",
      "disconnect",
      "onConnect",
      "offConnect",
      "onDisconnect",
      "offDisconnect",
      "onConnectionStateChange",
      "onVehicle",
      "offVehicle",
      "onStatus",
      "offStatus",
      "onOptions",
      "offOptions",
      "onHeatzones",
      "offHeatzones",
      "onDirection",
      "offDirection",
      "onReset",
      "offReset",
      // simulation + network
      "start",
      "stop",
      "reset",
      "direction",
      "batchDirection",
      "getStatus",
      "getVehicles",
      "getNetwork",
      "getRoads",
      "getPois",
      "findRoad",
      "findNode",
      "getOptions",
      "updateOptions",
      "getDirections",
      "getHeatzones",
      "createHeatzone",
      "updateHeatzone",
      "deleteHeatzone",
      "clearHeatzones",
      "seedHeatzones",
      "search",
      // fleets
      "getFleets",
      "createFleet",
      "deleteFleet",
      "assignVehicles",
      "unassignVehicles",
      "onFleetCreated",
      "offFleetCreated",
      "onFleetDeleted",
      "offFleetDeleted",
      "onFleetAssigned",
      "offFleetAssigned",
      "onWaypointReached",
      "offWaypointReached",
      "onRouteCompleted",
      "offRouteCompleted",
      // incidents
      "getIncidents",
      "createRandomIncident",
      "removeIncident",
      "createIncidentAtPosition",
      "onIncidentCreated",
      "offIncidentCreated",
      "onIncidentCleared",
      "offIncidentCleared",
      "onVehicleRerouted",
      "offVehicleRerouted",
      // recording / replay / generation
      "startRecording",
      "stopRecording",
      "getRecordings",
      "startReplay",
      "pauseReplay",
      "resumeReplay",
      "stopReplay",
      "seekReplay",
      "setReplaySpeed",
      "getReplayStatus",
      "onReplayStatus",
      "offReplayStatus",
      "generateRecording",
      "getGenerateStatus",
      "onGenerateProgress",
      "offGenerateProgress",
      "onGenerateComplete",
      "offGenerateComplete",
      "onGenerateError",
      "offGenerateError",
      // clock / traffic / analytics
      "getClock",
      "setClock",
      "onClock",
      "offClock",
      "getTraffic",
      "onTraffic",
      "offTraffic",
      "onAnalytics",
      "offAnalytics",
      "getAnalyticsSummary",
      "getFleetAnalytics",
      "resetAnalytics",
      // geofences
      "getGeofences",
      "createGeofence",
      "updateGeofence",
      "deleteGeofence",
      "toggleGeofence",
      "onGeofenceEvent",
      "offGeofenceEvent",
      "subscribe",
      // scenarios
      "getScenarios",
      "loadScenarioByName",
      "startScenario",
      "pauseScenario",
      "stopScenario",
      "getScenarioStatus",
      "onScenarioEvent",
      "offScenarioEvent",
    ] as const;

    it.each(EXPECTED_METHODS)("exposes %s as a function", (name) => {
      expect(typeof (service as unknown as Record<string, unknown>)[name]).toBe("function");
    });

    it("keeps every exposed method destructure-safe (bound, not bare prototype refs)", () => {
      for (const name of EXPECTED_METHODS) {
        const ref = (service as unknown as Record<string, unknown>)[name];
        // Bound methods are own enumerable properties on the instance, not
        // inherited from the prototype.
        expect(Object.prototype.hasOwnProperty.call(service, name)).toBe(true);
        expect(typeof ref).toBe("function");
      }
    });
  });
});
