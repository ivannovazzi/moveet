import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClientDeps } from "./types";
import { ConnectionSegment } from "./connection";
import { SimulationSegment } from "./simulation";
import { FleetSegment } from "./fleets";
import { IncidentSegment } from "./incidents";
import { RecordingSegment } from "./recording";
import { TelemetrySegment } from "./telemetry";
import { GeofenceSegment } from "./geofences";
import { ScenarioSegment } from "./scenarios";

// Per-segment delegation tests. The facade test (../client.test.ts) drives the
// singleton, but the per-segment source modules (utils/client/*.ts) are mostly
// thin delegators whose every method must reach the right http/ws call. These
// are the hot client modules pinned by the per-file coverage floor, so we
// exercise each method directly against mock deps.

function makeDeps() {
  const http = {
    get: vi.fn().mockResolvedValue({ data: undefined }),
    post: vi.fn().mockResolvedValue({ data: undefined }),
    patch: vi.fn().mockResolvedValue({ data: undefined }),
    delete: vi.fn().mockResolvedValue({ data: undefined }),
  };
  const ws = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    retry: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(),
    onConnectionStateChange: vi.fn().mockReturnValue(() => {}),
  };
  // The segments only use the members above; cast through unknown for the rest.
  const deps = { http, ws } as unknown as ClientDeps;
  return { deps, http, ws };
}

describe("ConnectionSegment", () => {
  let h: ReturnType<typeof makeDeps>;
  let seg: ConnectionSegment;
  beforeEach(() => {
    h = makeDeps();
    seg = new ConnectionSegment(h.deps);
  });

  it("delegates lifecycle to the ws client", () => {
    seg.connectWebSocket();
    seg.retryConnection();
    seg.disconnect();
    expect(h.ws.connect).toHaveBeenCalledOnce();
    expect(h.ws.retry).toHaveBeenCalledOnce();
    expect(h.ws.disconnect).toHaveBeenCalledOnce();
  });

  it("registers/unregisters connect & disconnect (wrapping the no-arg handlers)", () => {
    const onC = vi.fn();
    const onD = vi.fn();
    seg.onConnect(onC);
    seg.onDisconnect(onD);
    expect(h.ws.on).toHaveBeenCalledWith("connect", expect.any(Function));
    expect(h.ws.on).toHaveBeenCalledWith("disconnect", expect.any(Function));
    seg.offConnect(onC);
    seg.offDisconnect();
    expect(h.ws.off).toHaveBeenCalledWith("connect", onC);
    expect(h.ws.off).toHaveBeenCalledWith("disconnect", undefined);
  });

  it("passes the connection-state listener through and returns the unsubscribe", () => {
    const listener = vi.fn();
    const unsub = seg.onConnectionStateChange(listener);
    expect(h.ws.onConnectionStateChange).toHaveBeenCalledWith(listener);
    expect(typeof unsub).toBe("function");
  });

  it("validates vehicles on the hot path: passes finite, drops non-finite", () => {
    const handler = vi.fn();
    seg.onVehicle(handler);
    const single = h.ws.on.mock.calls.find((c) => c[0] === "vehicle")![1];
    const batch = h.ws.on.mock.calls.find((c) => c[0] === "vehicles")![1];
    const valid = { id: "v1", type: "car", position: [1, 2], speed: 10, heading: 90 };
    single(valid);
    expect(handler).toHaveBeenCalledWith(valid);
    handler.mockClear();
    // Non-finite is dropped (and only warns once).
    single({ ...valid, position: [NaN, 2] });
    single({ ...valid, speed: Infinity });
    expect(handler).not.toHaveBeenCalled();
    // The batched "vehicles" channel applies the same guard per element.
    batch([valid, { ...valid, heading: NaN }]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("registers and removes the remaining real-time channels", () => {
    const fn = vi.fn();
    seg.onStatus(fn);
    seg.offStatus(fn);
    seg.onOptions(fn);
    seg.offOptions();
    seg.onHeatzones(fn);
    seg.offHeatzones();
    seg.onDirection(fn);
    seg.offDirection();
    seg.onReset(fn);
    seg.offReset();
    seg.offVehicle();
    expect(h.ws.on).toHaveBeenCalledWith("status", fn);
    expect(h.ws.on).toHaveBeenCalledWith("options", fn);
    expect(h.ws.on).toHaveBeenCalledWith("heatzones", fn);
    expect(h.ws.on).toHaveBeenCalledWith("direction", fn);
    expect(h.ws.on).toHaveBeenCalledWith("reset", fn);
    expect(h.ws.off).toHaveBeenCalledWith("vehicle");
    expect(h.ws.off).toHaveBeenCalledWith("vehicles");
  });
});

describe("SimulationSegment", () => {
  let h: ReturnType<typeof makeDeps>;
  let seg: SimulationSegment;
  beforeEach(() => {
    h = makeDeps();
    seg = new SimulationSegment(h.deps);
  });

  it("routes control + query methods to the right endpoints", async () => {
    await seg.start({ minSpeed: 5 } as never);
    await seg.stop();
    await seg.reset();
    await seg.direction(["a", "b"], [36.8, -1.3]);
    await seg.batchDirection([{ id: "a", lat: -1.3, lng: 36.8 }]);
    await seg.getStatus();
    await seg.getVehicles();
    await seg.getNetwork();
    await seg.getRoads();
    await seg.getPois();
    await seg.findRoad([36.8, -1.3]);
    await seg.findNode([36.8, -1.3]);
    await seg.getOptions();
    await seg.updateOptions({ minSpeed: 6 } as never);
    await seg.getDirections();
    await seg.getHeatzones();
    await seg.makeHeatzones();
    await seg.search("Ngong");

    expect(h.http.post).toHaveBeenCalledWith("/start", { minSpeed: 5 });
    expect(h.http.post).toHaveBeenCalledWith("/stop");
    expect(h.http.post).toHaveBeenCalledWith("/reset");
    expect(h.http.post).toHaveBeenCalledWith("/direction", [{ id: "a", lat: -1.3, lng: 36.8 }]);
    expect(h.http.post).toHaveBeenCalledWith("/find-road", [36.8, -1.3]);
    expect(h.http.post).toHaveBeenCalledWith("/find-node", [36.8, -1.3]);
    expect(h.http.post).toHaveBeenCalledWith("/options", { minSpeed: 6 });
    expect(h.http.post).toHaveBeenCalledWith("/heatzones");
    expect(h.http.post).toHaveBeenCalledWith("/search", { query: "Ngong" });
    expect(h.http.get).toHaveBeenCalledWith("/status");
    expect(h.http.get).toHaveBeenCalledWith("/vehicles");
    expect(h.http.get).toHaveBeenCalledWith("/network");
    expect(h.http.get).toHaveBeenCalledWith("/roads");
    expect(h.http.get).toHaveBeenCalledWith("/pois");
    expect(h.http.get).toHaveBeenCalledWith("/options");
    expect(h.http.get).toHaveBeenCalledWith("/directions");
    expect(h.http.get).toHaveBeenCalledWith("/heatzones");
  });
});

describe("FleetSegment", () => {
  let h: ReturnType<typeof makeDeps>;
  let seg: FleetSegment;
  beforeEach(() => {
    h = makeDeps();
    seg = new FleetSegment(h.deps);
  });

  it("routes fleet CRUD + assignment", async () => {
    await seg.getFleets();
    await seg.createFleet("North");
    await seg.deleteFleet("f1");
    await seg.assignVehicles("f1", ["v1", "v2"]);
    await seg.unassignVehicles("f1", ["v1"]);
    expect(h.http.get).toHaveBeenCalledWith("/fleets");
    expect(h.http.post).toHaveBeenCalledWith("/fleets", { name: "North" });
    expect(h.http.delete).toHaveBeenCalledWith("/fleets/f1");
    expect(h.http.post).toHaveBeenCalledWith("/fleets/f1/assign", { vehicleIds: ["v1", "v2"] });
    expect(h.http.post).toHaveBeenCalledWith("/fleets/f1/unassign", { vehicleIds: ["v1"] });
  });

  it("wires fleet/route lifecycle ws events", () => {
    const fn = vi.fn();
    seg.onFleetCreated(fn);
    seg.offFleetCreated();
    seg.onFleetDeleted(fn);
    seg.offFleetDeleted();
    seg.onFleetAssigned(fn);
    seg.offFleetAssigned();
    seg.onWaypointReached(fn);
    seg.offWaypointReached();
    seg.onRouteCompleted(fn);
    seg.offRouteCompleted();
    for (const e of [
      "fleet:created",
      "fleet:deleted",
      "fleet:assigned",
      "waypoint:reached",
      "route:completed",
    ]) {
      expect(h.ws.on).toHaveBeenCalledWith(e, fn);
      expect(h.ws.off).toHaveBeenCalledWith(e, undefined);
    }
  });
});

describe("IncidentSegment", () => {
  let h: ReturnType<typeof makeDeps>;
  let seg: IncidentSegment;
  beforeEach(() => {
    h = makeDeps();
    seg = new IncidentSegment(h.deps);
  });

  it("routes incident endpoints", async () => {
    await seg.getIncidents();
    await seg.createRandomIncident();
    await seg.removeIncident("i1");
    await seg.createIncidentAtPosition(-1.3, 36.8, "accident" as never);
    expect(h.http.get).toHaveBeenCalledWith("/incidents");
    expect(h.http.post).toHaveBeenCalledWith("/incidents/random");
    expect(h.http.delete).toHaveBeenCalledWith("/incidents/i1");
    expect(h.http.post).toHaveBeenCalledWith("/incidents/at-position", {
      lat: -1.3,
      lng: 36.8,
      type: "accident",
    });
  });

  it("wires incident/reroute ws events", () => {
    const fn = vi.fn();
    seg.onIncidentCreated(fn);
    seg.offIncidentCreated();
    seg.onIncidentCleared(fn);
    seg.offIncidentCleared();
    seg.onVehicleRerouted(fn);
    seg.offVehicleRerouted();
    for (const e of ["incident:created", "incident:cleared", "vehicle:rerouted"]) {
      expect(h.ws.on).toHaveBeenCalledWith(e, fn);
      expect(h.ws.off).toHaveBeenCalledWith(e, undefined);
    }
  });
});

describe("RecordingSegment", () => {
  let h: ReturnType<typeof makeDeps>;
  let seg: RecordingSegment;
  beforeEach(() => {
    h = makeDeps();
    seg = new RecordingSegment(h.deps);
  });

  it("routes recording + replay transport", async () => {
    await seg.startRecording();
    await seg.stopRecording();
    await seg.getRecordings();
    await seg.startReplay("a.json", 2);
    await seg.pauseReplay();
    await seg.resumeReplay();
    await seg.stopReplay();
    await seg.seekReplay(123);
    await seg.setReplaySpeed(4);
    await seg.getReplayStatus();
    await seg.generateRecording({ hours: 1 } as never);
    await seg.getGenerateStatus();
    expect(h.http.post).toHaveBeenCalledWith("/recording/start");
    expect(h.http.post).toHaveBeenCalledWith("/recording/stop");
    expect(h.http.get).toHaveBeenCalledWith("/recordings");
    expect(h.http.post).toHaveBeenCalledWith("/replay/start", { file: "a.json", speed: 2 });
    expect(h.http.post).toHaveBeenCalledWith("/replay/pause");
    expect(h.http.post).toHaveBeenCalledWith("/replay/resume");
    expect(h.http.post).toHaveBeenCalledWith("/replay/stop");
    expect(h.http.post).toHaveBeenCalledWith("/replay/seek", { timestamp: 123 });
    expect(h.http.post).toHaveBeenCalledWith("/replay/speed", { speed: 4 });
    expect(h.http.get).toHaveBeenCalledWith("/replay/status");
    expect(h.http.post).toHaveBeenCalledWith("/recording/generate", { hours: 1 });
    expect(h.http.get).toHaveBeenCalledWith("/recording/generate/status");
  });

  it("wires replay/generate ws events", () => {
    const fn = vi.fn();
    seg.onReplayStatus(fn);
    seg.offReplayStatus();
    seg.onGenerateProgress(fn);
    seg.offGenerateProgress();
    seg.onGenerateComplete(fn);
    seg.offGenerateComplete();
    seg.onGenerateError(fn);
    seg.offGenerateError();
    for (const e of ["replay:status", "generate:progress", "generate:complete", "generate:error"]) {
      expect(h.ws.on).toHaveBeenCalledWith(e, fn);
      expect(h.ws.off).toHaveBeenCalledWith(e, undefined);
    }
  });
});

describe("TelemetrySegment", () => {
  let h: ReturnType<typeof makeDeps>;
  let seg: TelemetrySegment;
  beforeEach(() => {
    h = makeDeps();
    seg = new TelemetrySegment(h.deps);
  });

  it("routes clock/traffic/analytics endpoints", async () => {
    await seg.getClock();
    await seg.setClock({ speedMultiplier: 2 });
    await seg.getTraffic();
    await seg.getAnalyticsSummary();
    await seg.getFleetAnalytics("f1");
    await seg.resetAnalytics();
    expect(h.http.get).toHaveBeenCalledWith("/clock");
    expect(h.http.post).toHaveBeenCalledWith("/clock", { speedMultiplier: 2 });
    expect(h.http.get).toHaveBeenCalledWith("/traffic");
    expect(h.http.get).toHaveBeenCalledWith("/analytics/summary");
    expect(h.http.get).toHaveBeenCalledWith("/analytics/fleet/f1");
    expect(h.http.post).toHaveBeenCalledWith("/analytics/reset");
  });

  it("wires clock/traffic/analytics ws events", () => {
    const fn = vi.fn();
    seg.onClock(fn);
    seg.offClock();
    seg.onTraffic(fn);
    seg.offTraffic();
    seg.onAnalytics(fn);
    seg.offAnalytics();
    for (const e of ["clock", "traffic", "analytics"]) {
      expect(h.ws.on).toHaveBeenCalledWith(e, fn);
      expect(h.ws.off).toHaveBeenCalledWith(e, undefined);
    }
  });
});

describe("GeofenceSegment", () => {
  let h: ReturnType<typeof makeDeps>;
  let seg: GeofenceSegment;
  beforeEach(() => {
    h = makeDeps();
    seg = new GeofenceSegment(h.deps);
  });

  it("routes geofence CRUD/toggle + subscribe + events", async () => {
    await seg.getGeofences();
    await seg.createGeofence({ name: "Zone" } as never);
    await seg.updateGeofence("g1", { name: "Zone2" } as never);
    await seg.deleteGeofence("g1");
    await seg.toggleGeofence("g1");
    const fn = vi.fn();
    seg.onGeofenceEvent(fn);
    seg.offGeofenceEvent();
    seg.subscribe({ bbox: [0, 0, 1, 1] } as never);
    seg.subscribe(null);
    expect(h.http.get).toHaveBeenCalledWith("/geofences");
    expect(h.http.post).toHaveBeenCalledWith("/geofences", { name: "Zone" });
    expect(h.http.patch).toHaveBeenCalledWith("/geofences/g1", { name: "Zone2" });
    expect(h.http.delete).toHaveBeenCalledWith("/geofences/g1");
    expect(h.http.post).toHaveBeenCalledWith("/geofences/g1/toggle");
    expect(h.ws.on).toHaveBeenCalledWith("geofence:event", fn);
    expect(h.ws.off).toHaveBeenCalledWith("geofence:event", undefined);
    expect(h.ws.send).toHaveBeenCalledWith({ type: "subscribe", filter: { bbox: [0, 0, 1, 1] } });
    expect(h.ws.send).toHaveBeenCalledWith({ type: "subscribe", filter: null });
  });
});

describe("ScenarioSegment", () => {
  let h: ReturnType<typeof makeDeps>;
  let seg: ScenarioSegment;
  beforeEach(() => {
    h = makeDeps();
    seg = new ScenarioSegment(h.deps);
  });

  it("routes scenario discovery/load/transport + fan-in events", async () => {
    await seg.getScenarios();
    await seg.loadScenarioByName("rush hour.json");
    await seg.startScenario();
    await seg.pauseScenario();
    await seg.stopScenario();
    await seg.getScenarioStatus();
    expect(h.http.get).toHaveBeenCalledWith("/scenarios");
    // file name must be URL-encoded into the path
    expect(h.http.post).toHaveBeenCalledWith("/scenarios/load/rush%20hour.json");
    expect(h.http.post).toHaveBeenCalledWith("/scenarios/start");
    expect(h.http.post).toHaveBeenCalledWith("/scenarios/pause");
    expect(h.http.post).toHaveBeenCalledWith("/scenarios/stop");
    expect(h.http.get).toHaveBeenCalledWith("/scenarios/status");
  });

  it("subscribes/unsubscribes the full consolidated scenario event set", () => {
    const fn = vi.fn();
    seg.onScenarioEvent(fn);
    seg.offScenarioEvent();
    const events = [
      "scenario:event",
      "scenario:started",
      "scenario:completed",
      "scenario:paused",
      "scenario:resumed",
      "scenario:stopped",
    ];
    for (const e of events) {
      expect(h.ws.on).toHaveBeenCalledWith(e, fn);
      expect(h.ws.off).toHaveBeenCalledWith(e);
    }
  });
});
