import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import { VehicleManager } from "../modules/VehicleManager";
import { FleetManager } from "../modules/FleetManager";
import { RoadNetwork } from "../modules/RoadNetwork";
import { AdapterSyncManager } from "../modules/AdapterSyncManager";
import { JobManager } from "../modules/JobManager";
import { config } from "../utils/config";
import type { DirectionResult, Vehicle, VehicleDTO } from "../types";

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");

/**
 * Device faults must be observable in the OUTGOING telemetry, not just inside
 * the fault module. These tests cover the two egress paths: the `update` event
 * (WebSocket + recording) and the periodic adapter push — plus the boundary on
 * the other side of them, where a simulator-internal decision (job assignment)
 * must keep reading the truth.
 */

describe("device fault egress — vehicle update stream", () => {
  let network: RoadNetwork;
  let manager: VehicleManager;
  let origVehicleCount: number;
  let origAdapterURL: string;

  beforeEach(() => {
    origVehicleCount = config.vehicleCount;
    origAdapterURL = config.adapterURL;
    (config as any).vehicleCount = 2;
    (config as any).adapterURL = "";

    network = new RoadNetwork(FIXTURE_PATH);

    // Skip pathfinding during init — the tiny fixture network cannot route.
    const proto = VehicleManager.prototype as any;
    const origSetRandom = proto.setRandomDestination;
    proto.setRandomDestination = function () {};
    manager = new VehicleManager(network, new FleetManager());
    proto.setRandomDestination = origSetRandom;
  });

  afterEach(() => {
    (config as any).vehicleCount = origVehicleCount;
    (config as any).adapterURL = origAdapterURL;
    for (const v of manager.getVehicles()) manager.stopVehicleMovement(v.id);
    manager.stopLocationUpdates();
  });

  function firstVehicle(): Vehicle {
    return manager.registry.getAll().values().next().value as Vehicle;
  }

  function dtoFor(vehicle: Vehicle): VehicleDTO {
    return {
      id: vehicle.id,
      name: vehicle.name,
      type: vehicle.type,
      position: vehicle.position,
      speed: vehicle.speed,
      heading: vehicle.bearing,
    };
  }

  it("forwards the game-loop DTO untouched while no fault is armed", () => {
    const updates: VehicleDTO[] = [];
    manager.on("update", (dto: VehicleDTO) => updates.push(dto));
    const input = dtoFor(firstVehicle());

    manager.gameLoop.emit("update", input);

    expect(updates).toEqual([input]);
    expect(updates[0]!.timestamp).toBeUndefined();
    expect(updates[0]!.faults).toBeUndefined();
  });

  it("emits the device's faulted sample once a profile is armed", () => {
    manager.faults.configure({
      enabled: true,
      seed: 3,
      default: { clockSkew: { offsetMs: 4000 } },
    });
    const updates: VehicleDTO[] = [];
    manager.on("update", (dto: VehicleDTO) => updates.push(dto));

    manager.gameLoop.emit("update", dtoFor(firstVehicle()));

    expect(updates).toHaveLength(1);
    expect(updates[0]!.faults).toMatchObject({ active: ["clock_skew"], skewMs: 4000 });
    expect(updates[0]!.timestamp).toBeGreaterThan(0);
  });

  it("fans one report out to several frames when the device duplicates", () => {
    manager.faults.configure({
      enabled: true,
      seed: 3,
      default: { duplicate: { probability: 1, maxCopies: 1 } },
    });
    const updates: VehicleDTO[] = [];
    manager.on("update", (dto: VehicleDTO) => updates.push(dto));

    manager.gameLoop.emit("update", dtoFor(firstVehicle()));

    expect(updates).toHaveLength(2);
    expect(updates[1]!.faults?.active).toContain("duplicate");
  });

  it("emits no frame at all for a device whose battery has died", () => {
    manager.faults.configure({
      enabled: true,
      seed: 3,
      default: { battery: { initialPercent: 0, drainPercentPerHour: 1, dieAtPercent: 0 } },
    });
    const updates: VehicleDTO[] = [];
    manager.on("update", (dto: VehicleDTO) => updates.push(dto));

    manager.gameLoop.emit("update", dtoFor(firstVehicle()));

    expect(updates).toEqual([]);
    expect(manager.faults.getStatus().dead).toBe(1);
  });

  it("serves the device's frozen fix from GET /vehicles, not the true position", () => {
    manager.faults.configure({
      enabled: true,
      seed: 3,
      default: { frozenGps: { probability: 1, minDurationMs: 60_000, maxDurationMs: 60_000 } },
    });
    const vehicle = firstVehicle();
    manager.gameLoop.emit("update", dtoFor(vehicle));
    const frozenAt: [number, number] = [...vehicle.position] as [number, number];

    // The vehicle moves on, but its device is stuck.
    vehicle.position = [frozenAt[0] + 0.02, frozenAt[1] + 0.02];

    const listed = manager.getVehicles().find((v) => v.id === vehicle.id)!;
    expect(listed.position).toEqual(frozenAt);
    expect(listed.faults?.active).toContain("frozen_gps");
  });

  it("keeps reporting the frozen fix on an out-of-band fleet-assignment frame", () => {
    manager.faults.configure({
      enabled: true,
      seed: 3,
      default: { frozenGps: { probability: 1, minDurationMs: 60_000, maxDurationMs: 60_000 } },
    });
    const vehicle = firstVehicle();
    manager.gameLoop.emit("update", dtoFor(vehicle));
    const frozenAt: [number, number] = [...vehicle.position] as [number, number];
    vehicle.position = [frozenAt[0] + 0.02, frozenAt[1] + 0.02];

    const fleet = manager.fleets.createFleet("F1");
    const updates: VehicleDTO[] = [];
    manager.on("update", (dto: VehicleDTO) => updates.push(dto));

    expect(manager.assignVehicleToFleet(vehicle.id, fleet.id)).toBe(true);

    expect(updates).toHaveLength(1);
    expect(updates[0]!.position).toEqual(frozenAt);
  });

  it("clears latched device state on simulation reset, keeping the config", async () => {
    manager.faults.configure({
      enabled: true,
      seed: 3,
      default: { frozenGps: { probability: 1, minDurationMs: 60_000, maxDurationMs: 60_000 } },
    });
    manager.gameLoop.emit("update", dtoFor(firstVehicle()));
    expect(manager.faults.getStatus().devices).toBe(1);

    const proto = VehicleManager.prototype as any;
    const origSetRandom = proto.setRandomDestination;
    proto.setRandomDestination = function () {};
    try {
      await manager.reset();
    } finally {
      proto.setRandomDestination = origSetRandom;
    }

    expect(manager.faults.getStatus().devices).toBe(0);
    expect(manager.faults.isActive()).toBe(true);
  });
});

describe("device fault egress — adapter push", () => {
  let syncManager: AdapterSyncManager;
  let origAdapterURL: string;

  beforeEach(() => {
    origAdapterURL = config.adapterURL;
    (config as any).adapterURL = "";
    syncManager = new AdapterSyncManager();
  });

  afterEach(() => {
    (config as any).adapterURL = origAdapterURL;
    syncManager.stopLocationUpdates();
  });

  const vehicle = {
    id: "v1",
    name: "V1",
    type: "car" as const,
    position: [-1.3, 36.85] as [number, number],
    currentEdge: { id: "e1" } as any,
    speed: 30,
    bearing: 90,
    progress: 0,
    sourceMetadata: { deviceId: "dev-1" },
  };

  function sample(overrides: Partial<VehicleDTO> = {}): VehicleDTO {
    return {
      id: "v1",
      name: "V1",
      type: "car",
      position: [-1.3, 36.85],
      speed: 30,
      heading: 90,
      timestamp: 1_700_000_000_000,
      faults: { active: ["clock_skew"], skewMs: 5000 },
      ...overrides,
    };
  }

  /** Runs exactly one sync cycle and returns the pushed payload. */
  async function pushOnce(
    getFaulted: (() => VehicleDTO[] | null) | undefined
  ): Promise<{ vehicles: any[] } | undefined> {
    const adapter = (syncManager as any).adapter;
    const syncSpy = vi.spyOn(adapter, "sync").mockResolvedValue(undefined);
    const getVehicles = function* () {
      yield vehicle;
    };

    vi.useFakeTimers();
    try {
      syncManager.startLocationUpdates(1000, getVehicles as any, getFaulted);
      await vi.advanceTimersByTimeAsync(1000);
    } finally {
      syncManager.stopLocationUpdates();
      vi.useRealTimers();
    }
    return syncSpy.mock.calls[0]?.[0] as { vehicles: any[] } | undefined;
  }

  it("pushes the true-position snapshot when no fault egress is supplied", async () => {
    const payload = await pushOnce(undefined);

    expect(payload!.vehicles).toHaveLength(1);
    expect(payload!.vehicles[0]).toEqual({
      id: "v1",
      name: "V1",
      type: "car",
      latitude: -1.3,
      longitude: 36.85,
      speed: 30,
      heading: 90,
      metadata: { deviceId: "dev-1" },
    });
  });

  it("pushes the device's samples, with the applied faults and its own timestamp", async () => {
    const payload = await pushOnce(() => [sample()]);

    expect(payload!.vehicles[0]).toEqual({
      id: "v1",
      name: "V1",
      type: "car",
      latitude: -1.3,
      longitude: 36.85,
      speed: 30,
      heading: 90,
      timestamp: 1_700_000_000_000,
      metadata: { deviceId: "dev-1", faults: { active: ["clock_skew"], skewMs: 5000 } },
    });
  });

  it("preserves duplicates and out-of-order samples instead of coalescing them", async () => {
    const payload = await pushOnce(() => [
      sample({ timestamp: 2000 }),
      sample({ timestamp: 2000, faults: { active: ["duplicate"] } }),
      sample({ timestamp: 1000, faults: { active: ["out_of_order"] } }),
    ]);

    expect(payload!.vehicles).toHaveLength(3);
    expect(payload!.vehicles.map((v: any) => v.timestamp)).toEqual([2000, 2000, 1000]);
  });

  it("pushes nothing when every device was silent this window", async () => {
    const payload = await pushOnce(() => []);

    expect(payload).toBeUndefined();
  });
});

/**
 * Job assignment is the simulator's own dispatch decision, not one of the
 * consumers the fault layer exists to deceive. Arming a profile must change
 * what the fleet REPORTS without quietly changing which unit gets the work.
 */
describe("device faults — job assignment", () => {
  let network: RoadNetwork;
  let manager: VehicleManager;
  let jobs: JobManager;
  let origVehicleCount: number;
  let origAdapterURL: string;

  beforeEach(() => {
    origVehicleCount = config.vehicleCount;
    origAdapterURL = config.adapterURL;
    (config as any).vehicleCount = 2;
    (config as any).adapterURL = "";

    network = new RoadNetwork(FIXTURE_PATH);

    const proto = VehicleManager.prototype as any;
    const origSetRandom = proto.setRandomDestination;
    proto.setRandomDestination = function () {};
    manager = new VehicleManager(network, new FleetManager());
    proto.setRandomDestination = origSetRandom;

    // The fixture network cannot route, and routing is not what is under test —
    // only which vehicle the dispatcher hands the job to.
    vi.spyOn(manager, "findAndSetWaypointRoutes").mockImplementation(
      async (vehicleId: string): Promise<DirectionResult> => ({
        vehicleId,
        status: "ok",
        route: { start: [0, 0], end: [1, 1], distance: 12 },
        legs: [
          { start: [0, 0], end: [0.5, 0.5], distance: 4 },
          { start: [0.5, 0.5], end: [1, 1], distance: 8 },
        ],
      })
    );

    jobs = new JobManager(manager, { slaSeconds: 600, pickupDwellSeconds: 30 });
  });

  afterEach(() => {
    jobs.dispose();
    vi.restoreAllMocks();
    (config as any).vehicleCount = origVehicleCount;
    (config as any).adapterURL = origAdapterURL;
    for (const v of manager.getVehicles()) manager.stopVehicleMovement(v.id);
    manager.stopLocationUpdates();
  });

  function dtoFor(vehicle: Vehicle): VehicleDTO {
    return {
      id: vehicle.id,
      name: vehicle.name,
      type: vehicle.type,
      position: vehicle.position,
      speed: vehicle.speed,
      heading: vehicle.bearing,
    };
  }

  it("dispatches on the true position while the device reports a frozen fix", async () => {
    const [spoofed, other] = [...manager.registry.getAll().values()];
    manager.faults.configure({
      enabled: true,
      seed: 3,
      vehicles: {
        [spoofed.id]: {
          frozenGps: { probability: 1, minDurationMs: 60_000, maxDurationMs: 60_000 },
        },
      },
    });

    // The device latches its fix a long way out, then the vehicle drives to
    // within a stone's throw of the pickup while the fix stays behind.
    spoofed.position = [9, 9];
    manager.gameLoop.emit("update", dtoFor(spoofed));
    spoofed.position = [0.11, 0.11];
    other.position = [1, 1];

    const job = await jobs.createJob({
      pickup: { lat: 0.1, lng: 0.1 },
      dropoff: { lat: 0.4, lng: 0.4 },
    });

    expect(job.vehicleId).toBe(spoofed.id);
    // ...and the fault is still on the wire, which is the whole point of it.
    expect(manager.getVehicles().find((v) => v.id === spoofed.id)!.position).toEqual([9, 9]);
  });
});
