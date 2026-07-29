import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// wireEvents reads HEATZONE_TIME_SCALING (and ANALYTICS_INTERVAL) from the
// config singleton at call time, so the flag is flipped here rather than
// through process.env.
vi.mock("../../utils/config", () => ({
  config: {
    analyticsInterval: 5000,
    heatZoneTimeScaling: true,
  },
}));

vi.mock("../../utils/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { wireEvents, type EventWiringContext } from "../../setup/eventWiring";
import { HeatZoneManager } from "../../modules/HeatZoneManager";
import { SimulationClock } from "../../modules/SimulationClock";
import { GeoFenceManager } from "../../modules/GeoFenceManager";
import { DEFAULT_TRAFFIC_PROFILE } from "../../utils/trafficProfiles";
import type { Edge, Node } from "../../types";

const HOUR_MS = 60 * 60 * 1000;

function buildNodes(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    { id: "n1", coordinates: [45.5017, -73.5673], connections: [] },
    { id: "n2", coordinates: [45.502, -73.567], connections: [] },
    { id: "n3", coordinates: [45.5023, -73.5667], connections: [] },
    { id: "hub", coordinates: [45.5026, -73.5664], connections: [] },
  ];
  const mk = (id: string, start: Node, end: Node): Edge => ({
    id,
    streetId: "s1",
    start,
    end,
    distance: 0.5,
    bearing: 45,
    highway: "residential",
    maxSpeed: 30,
    surface: "unknown",
    oneway: false,
  });
  const edges = [
    mk("e1", nodes[0], nodes[1]),
    mk("e2", nodes[1], nodes[2]),
    mk("e3", nodes[2], nodes[3]),
  ];
  nodes[3].connections = edges;
  return { nodes, edges };
}

/**
 * A minimal RoadNetwork stand-in backed by a REAL HeatZoneManager, so the
 * recompute → "heatzones" emit → broadcaster path is genuinely exercised.
 */
function createFakeNetwork(heatZones: HeatZoneManager) {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    applyHeatZoneTimeOfDay: vi.fn((hour: number, profile = DEFAULT_TRAFFIC_PROFILE) => {
      const changed = heatZones.applyTimeOfDay(hour, profile);
      if (changed) emitter.emit("heatzones", heatZones.exportHeatedZonesAsFeatures());
      return changed;
    }),
  });
}

describe("wireEvents — heat-zone time-of-day scaling", () => {
  let heatZones: HeatZoneManager;
  let network: ReturnType<typeof createFakeNetwork>;
  let clock: SimulationClock;
  let broadcast: ReturnType<typeof vi.fn>;
  let recordEvent: ReturnType<typeof vi.fn>;
  let result: ReturnType<typeof wireEvents>;

  /** Wires events with the clock parked at `startHour`. */
  function wire(startHour: number): void {
    clock = new SimulationClock({ startHour, speedMultiplier: 1 });
    broadcast = vi.fn();
    recordEvent = vi.fn();

    const vehicleManager = Object.assign(new EventEmitter(), {
      clock,
      getTrafficProfile: vi.fn(() => DEFAULT_TRAFFIC_PROFILE),
      getTrafficSnapshot: vi.fn().mockReturnValue({ edges: {} }),
      analytics: { getSnapshot: vi.fn().mockReturnValue({}) },
      faults: new EventEmitter(),
    });

    const ctx = {
      network,
      vehicleManager,
      fleetManager: new EventEmitter(),
      jobManager: Object.assign(new EventEmitter(), { reset: vi.fn() }),
      incidentManager: new EventEmitter(),
      recordingManager: Object.assign(new EventEmitter(), {
        captureVehicleSnapshot: vi.fn(),
        recordEvent,
      }),
      simulationController: new EventEmitter(),
      broadcaster: {
        queueVehicleUpdate: vi.fn(),
        broadcast,
        clearVehicles: vi.fn(),
        clientCount: 1,
      },
      geoFenceManager: new GeoFenceManager(),
      scenarioManager: new EventEmitter(),
      generationManager: new EventEmitter(),
    } as unknown as EventWiringContext;

    result = wireEvents(ctx);
  }

  const heatzoneBroadcasts = () =>
    broadcast.mock.calls.filter(([channel]) => channel === "heatzones");

  beforeEach(() => {
    vi.useFakeTimers();
    heatZones = new HeatZoneManager();
    const { nodes, edges } = buildNodes();
    heatZones.generateHeatedZones(edges, nodes, { count: 3, minIntensity: 0.4, maxIntensity: 0.4 });
    network = createFakeNetwork(heatZones);
  });

  afterEach(() => {
    clearInterval(result.trafficBroadcastInterval);
    clearInterval(result.analyticsBroadcastInterval);
    clearInterval(result.recordingBatchInterval);
    vi.useRealTimers();
  });

  it("seeds the current simulated hour at wiring time", () => {
    // 02:00 is inside the profile's 00-05 night range (0.3x demand).
    wire(2);
    expect(network.applyHeatZoneTimeOfDay).toHaveBeenCalledTimes(1);
    expect(network.applyHeatZoneTimeOfDay).toHaveBeenCalledWith(2, DEFAULT_TRAFFIC_PROFILE);
    for (const zone of heatZones.getZones()) expect(zone.intensity).toBeCloseTo(0.4 * 0.3, 6);
    expect(heatzoneBroadcasts()).toHaveLength(1);
  });

  it("recomputes once per simulated hour, not once per tick", () => {
    wire(2);
    network.applyHeatZoneTimeOfDay.mockClear();

    // 600 ticks of 1s each = 10 simulated minutes, all inside hour 02.
    for (let i = 0; i < 600; i++) clock.tick(1000);
    expect(network.applyHeatZoneTimeOfDay).not.toHaveBeenCalled();

    // Cross into 03:00 — exactly one recompute for the whole hour.
    for (let i = 0; i < 3000; i++) clock.tick(1000);
    expect(clock.getHour()).toBe(3);
    expect(network.applyHeatZoneTimeOfDay).toHaveBeenCalledTimes(1);
    expect(network.applyHeatZoneTimeOfDay).toHaveBeenCalledWith(3, DEFAULT_TRAFFIC_PROFILE);
  });

  it("broadcasts only on hours where the demand curve actually moves", () => {
    // Start at 05:00: outside every profile range → 1.0x, nothing to change.
    wire(5);
    expect(heatzoneBroadcasts()).toHaveLength(0);

    clock.tick(2 * HOUR_MS); // 07:00 — morning rush begins (2.0x)
    expect(clock.getHour()).toBe(7);
    expect(heatzoneBroadcasts()).toHaveLength(1);

    clock.tick(HOUR_MS); // 08:00 — still morning rush, same multiplier
    expect(heatzoneBroadcasts()).toHaveLength(1);

    clock.tick(HOUR_MS); // 09:00 — back to 1.0x
    expect(heatzoneBroadcasts()).toHaveLength(2);

    const rush = heatzoneBroadcasts()[0][1] as Array<{ properties: { intensity: number } }>;
    const midday = heatzoneBroadcasts()[1][1] as Array<{ properties: { intensity: number } }>;
    expect(rush[0].properties.intensity).toBeGreaterThan(midday[0].properties.intensity);
  });

  it("records rescaled zones through the recording layer too", () => {
    wire(2);
    expect(recordEvent).toHaveBeenCalledWith("heatzone", expect.any(Array));
  });

  it("keeps manual zones fixed across simulated hours", () => {
    heatZones.addZone({
      polygon: [
        [-73.5673, 45.5017],
        [-73.5663, 45.5017],
        [-73.5663, 45.5027],
        [-73.5673, 45.5017],
      ],
      intensity: 0.85,
    });
    wire(5);

    clock.tick(2 * HOUR_MS); // 07:00
    clock.tick(12 * HOUR_MS); // 19:00
    clock.tick(7 * HOUR_MS); // 02:00 next day

    const manual = heatZones.getZones().find((z) => z.origin === "manual");
    expect(manual?.intensity).toBe(0.85);
  });
});
