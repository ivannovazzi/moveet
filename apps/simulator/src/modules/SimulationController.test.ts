import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { SimulationController } from "./SimulationController";
import { SimulationClock } from "./SimulationClock";
import type { VehicleManager } from "./VehicleManager";
import type { IncidentManager } from "./IncidentManager";
import type { RoadNetwork } from "./RoadNetwork";

/**
 * Creates a minimal mock VehicleManager with the methods used by SimulationController.
 * Uses a real SimulationClock and a real EventEmitter so listener counts can be inspected.
 */
function createMockVehicleManager() {
  const clock = new SimulationClock({ startHour: 7, speedMultiplier: 1 });
  const networkMock = {
    generateHeatedZones: vi.fn(),
    clearIncidentEdges: vi.fn(),
    setIncidentEdges: vi.fn(),
  } as unknown as RoadNetwork;

  return {
    clock,
    setOptions: vi.fn(),
    getOptions: vi.fn().mockReturnValue({ updateInterval: 500 }),
    getVehicles: vi.fn().mockReturnValue([]),
    getDirections: vi.fn().mockReturnValue([]),
    isRunning: vi.fn().mockReturnValue(false),
    startVehicleMovement: vi.fn(),
    stopVehicleMovement: vi.fn(),
    startLocationUpdates: vi.fn(),
    stopLocationUpdates: vi.fn(),
    getNetwork: vi.fn().mockReturnValue(networkMock),
    handleIncidentCreated: vi.fn(),
    reset: vi.fn().mockResolvedValue(undefined),
    getTrafficProfile: vi.fn().mockReturnValue({ name: "default", timeRanges: [] }),
    setTrafficProfile: vi.fn(),
  } as unknown as VehicleManager;
}

/**
 * Creates a mock IncidentManager backed by a real EventEmitter so
 * listener counts can be inspected.
 */
function createMockIncidentManager() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    startCleanup: vi.fn(),
    stopCleanup: vi.fn(),
    clearAll: vi.fn(),
    getActiveIncidents: vi.fn().mockReturnValue([]),
  }) as unknown as IncidentManager;
}

// Mock the config module so tests don't read .env or require a geojson file
vi.mock("../utils/config", () => ({
  config: {
    port: 5010,
    updateInterval: 500,
    minSpeed: 20,
    maxSpeed: 60,
    acceleration: 5,
    deceleration: 7,
    turnThreshold: 30,
    speedVariation: 0.1,
    heatZoneSpeedFactor: 0.5,
    syncAdapterTimeout: 5000,
    vehicleCount: 70,
    geojsonPath: "./export.geojson",
    adapterURL: "",
  },
  verifyConfig: vi.fn(),
}));

describe("SimulationController listener lifecycle", () => {
  let vehicleManager: VehicleManager;
  let incidentManager: IncidentManager;
  let controller: SimulationController;

  beforeEach(() => {
    vi.useFakeTimers();
    vehicleManager = createMockVehicleManager();
    incidentManager = createMockIncidentManager();
    controller = new SimulationController(vehicleManager, incidentManager);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should register incident and clock listeners on start()", async () => {
    const im = incidentManager as unknown as EventEmitter;
    const clock = vehicleManager.clock;

    expect(im.listenerCount("incident:created")).toBe(0);
    expect(im.listenerCount("incident:cleared")).toBe(0);
    expect(clock.listenerCount("hour:changed")).toBe(0);

    await controller.start({});

    expect(im.listenerCount("incident:created")).toBe(1);
    expect(im.listenerCount("incident:cleared")).toBe(1);
    expect(clock.listenerCount("hour:changed")).toBe(1);
  });

  it("should remove incident and clock listeners on stop()", async () => {
    const im = incidentManager as unknown as EventEmitter;
    const clock = vehicleManager.clock;

    await controller.start({});
    controller.stop();

    expect(im.listenerCount("incident:created")).toBe(0);
    expect(im.listenerCount("incident:cleared")).toBe(0);
    expect(clock.listenerCount("hour:changed")).toBe(0);
  });

  it("should not accumulate listeners after multiple start/stop cycles", async () => {
    const im = incidentManager as unknown as EventEmitter;
    const clock = vehicleManager.clock;

    for (let i = 0; i < 5; i++) {
      await controller.start({});
      controller.stop();
    }

    expect(im.listenerCount("incident:created")).toBe(0);
    expect(im.listenerCount("incident:cleared")).toBe(0);
    expect(clock.listenerCount("hour:changed")).toBe(0);
  });

  it("should not accumulate listeners after multiple start/reset cycles", async () => {
    const im = incidentManager as unknown as EventEmitter;
    const clock = vehicleManager.clock;

    for (let i = 0; i < 5; i++) {
      await controller.start({});
      await controller.reset();
    }

    expect(im.listenerCount("incident:created")).toBe(0);
    expect(im.listenerCount("incident:cleared")).toBe(0);
    expect(clock.listenerCount("hour:changed")).toBe(0);
  });

  it("should have exactly 1 listener of each type while simulation is running", async () => {
    const im = incidentManager as unknown as EventEmitter;
    const clock = vehicleManager.clock;

    // Simulate multiple reset->start cycles (like a user restarting the simulation)
    for (let i = 0; i < 3; i++) {
      await controller.reset();
      await controller.start({});
    }

    // While running, there should be exactly 1 of each listener, not 3
    expect(im.listenerCount("incident:created")).toBe(1);
    expect(im.listenerCount("incident:cleared")).toBe(1);
    expect(clock.listenerCount("hour:changed")).toBe(1);
  });

  it("should still fire incident listeners correctly after restart", async () => {
    const im = incidentManager as unknown as EventEmitter;
    const handleSpy = vehicleManager.handleIncidentCreated as ReturnType<typeof vi.fn>;

    // First cycle
    await controller.start({});
    await controller.reset();

    // Second cycle
    await controller.start({});

    // Emit an incident — the handler should fire exactly once
    const fakeIncident = {
      id: "test-1",
      edgeIds: ["e1"],
      type: "accident",
      severity: 0.5,
      speedFactor: 0.3,
      startTime: Date.now(),
      duration: 60000,
      autoClears: true,
      position: [0, 0] as [number, number],
    };
    im.emit("incident:created", fakeIncident);

    expect(handleSpy).toHaveBeenCalledTimes(1);
    expect(handleSpy).toHaveBeenCalledWith(fakeIncident);
  });

  it("should still fire clock listener correctly after restart", async () => {
    const clock = vehicleManager.clock;
    const clockSpy = vi.fn();
    controller.on("clock", clockSpy);

    // First cycle
    await controller.start({});
    await controller.reset();

    // Second cycle
    await controller.start({});

    // Emit an hour change — the handler should fire exactly once
    clock.emit("hour:changed", 10, "midday");

    expect(clockSpy).toHaveBeenCalledTimes(1);
  });

  it("should work correctly without an incident manager", async () => {
    const controllerNoIncidents = new SimulationController(vehicleManager);
    const clock = vehicleManager.clock;

    // Should not throw
    await controllerNoIncidents.start({});
    expect(clock.listenerCount("hour:changed")).toBe(1);

    controllerNoIncidents.stop();
    expect(clock.listenerCount("hour:changed")).toBe(0);

    // Multiple cycles should not accumulate
    for (let i = 0; i < 3; i++) {
      await controllerNoIncidents.start({});
      controllerNoIncidents.stop();
    }
    expect(clock.listenerCount("hour:changed")).toBe(0);
  });
});
