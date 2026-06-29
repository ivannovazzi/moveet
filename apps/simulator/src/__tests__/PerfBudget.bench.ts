import { bench, describe, beforeAll } from "vitest";
import path from "path";
import { VehicleManager } from "../modules/VehicleManager";
import { FleetManager } from "../modules/FleetManager";
import { RoadNetwork } from "../modules/RoadNetwork";
import { config } from "../utils/config";
import { setAmbientRng } from "../utils/rng";
import type { Node } from "../types";

/**
 * Microbenchmarks for the hot paths the PerfBudget guard protects.
 *
 * These are reporting-only (`vitest bench`) and are DELIBERATELY excluded from
 * `npm test` (the default config's `include` only matches `*.test.ts` /
 * `*.spec.ts`, and the `bench` script below points vitest at this file). Run
 * with `npm run test:bench`. They never gate CI, so their inherent timing
 * variance can never flake the unit suite. The committed pass/fail budget guard
 * lives in PerfBudget.test.ts.
 */

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");
const VEHICLE_COUNT = 10;

describe("pathfinding + tick microbenchmarks", () => {
  let network: RoadNetwork;
  let manager: VehicleManager;
  let start: Node;
  let end: Node;

  beforeAll(() => {
    setAmbientRng(0x5eed);
    (config as { vehicleCount: number }).vehicleCount = VEHICLE_COUNT;
    (config as { adapterURL: string }).adapterURL = "";

    network = new RoadNetwork(FIXTURE_PATH);
    manager = new VehicleManager(network, new FleetManager());
    manager.setOptions({ minSpeed: 30, maxSpeed: 60, speedVariation: 0 });
    for (const v of manager.registry.getAll().values()) {
      v.speed = 40;
      v.targetSpeed = 40;
      v.dwellUntil = undefined;
      manager.startVehicleMovement(v.id, 500);
    }

    start = network.findNearestNode([45.5017, -73.5673]);
    end = network.findNearestNode([45.5029, -73.5661]);
  });

  bench("single A* findRoute (cold cache)", () => {
    network.clearRouteCache();
    network.findRoute(start, end);
  });

  bench(`full game-loop tick (${VEHICLE_COUNT} vehicles)`, () => {
    manager.gameLoop.gameLoopTick();
  });
});
