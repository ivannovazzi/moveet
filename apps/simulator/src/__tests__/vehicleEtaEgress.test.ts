import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import { VehicleManager } from "../modules/VehicleManager";
import { FleetManager } from "../modules/FleetManager";
import { RoadNetwork } from "../modules/RoadNetwork";
import { config } from "../utils/config";
import type { Route, Vehicle, VehicleDTO } from "../types";

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");

/**
 * fleetsim-all-1ajn.12: the live remaining ETA rides the vehicle sample, so the
 * UI gets a moving ETA without a second channel or a client-side guess. Both
 * egress paths must agree — the per-tick `update` event and the polled
 * `getVehicles` snapshot.
 */
describe("vehicle ETA egress", () => {
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
    return manager.registry.getAll().values().next().value!;
  }

  function routeFrom(vehicle: Vehicle, count = 3): Route {
    const edges = [vehicle.currentEdge];
    let node = vehicle.currentEdge.end;
    while (edges.length < count) {
      const next = node.connections.find((e) => e.id !== edges[edges.length - 1].id);
      if (!next) break;
      edges.push(next);
      node = next.end;
    }
    return { edges, distance: edges.reduce((sum, e) => sum + e.distance, 0) };
  }

  it("omits etaSeconds for an unrouted vehicle", () => {
    const dto = manager.getVehicles().find((v) => v.id === firstVehicle().id)!;
    expect(dto.etaSeconds).toBeUndefined();
  });

  it("carries etaSeconds on the polled snapshot once a route is set", () => {
    const vehicle = firstVehicle();
    vehicle.edgeIndex = 0;
    vehicle.progress = 0;
    manager.routeManager.setRoute(vehicle.id, routeFrom(vehicle));

    const dto = manager.getVehicles().find((v) => v.id === vehicle.id)!;
    expect(dto.etaSeconds).toBeGreaterThan(0);
  });

  it("emits the same etaSeconds on the per-tick update event", () => {
    const vehicle = firstVehicle();
    vehicle.edgeIndex = 0;
    vehicle.progress = 0;
    manager.routeManager.setRoute(vehicle.id, routeFrom(vehicle));

    const samples: VehicleDTO[] = [];
    manager.on("update", (dto: VehicleDTO) => samples.push(dto));
    // Tick without moving anything: the sample must still carry the ETA.
    manager.gameLoop.updateVehicleFn = () => {};
    manager.gameLoop.startVehicleMovement(vehicle.id, 1000);
    manager.gameLoop.gameLoopTick();
    manager.gameLoop.stopVehicleMovement(vehicle.id);

    const sample = samples.find((s) => s.id === vehicle.id)!;
    const polled = manager.getVehicles().find((v) => v.id === vehicle.id)!;
    expect(sample.etaSeconds).toBeGreaterThan(0);
    expect(sample.etaSeconds).toBeCloseTo(polled.etaSeconds!, 6);
  });
});
