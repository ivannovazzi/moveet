import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import { VehicleManager } from "../modules/VehicleManager";
import { FleetManager } from "../modules/FleetManager";
import { RoadNetwork } from "../modules/RoadNetwork";
import { config } from "../utils/config";
import { setAmbientRng, defaultRng } from "../utils/rng";

/**
 * Perf/load budget guard (architecture review #4).
 *
 * This is a DETERMINISTIC budget-assertion test, NOT a microbenchmark. It runs
 * a fixed amount of work on the small fixture network and asserts it completes
 * under a GENEROUS wall-clock budget. The budgets are sized at roughly 5-10x
 * typical local timing so normal CI jitter, a cold JIT, or a loaded runner
 * never flakes them — the point is to catch GROSS regressions (an accidental
 * O(n^2) blow-up, a sync I/O stall, a pathfinding heuristic that stops pruning),
 * not to police micro-timing. If one of these trips, something got dramatically
 * slower and is worth a look.
 *
 * Determinism: a seeded RNG is installed for the whole file so vehicle
 * placement/routing is reproducible; the budgets do not depend on which random
 * route a vehicle happens to draw.
 *
 * A real microbenchmark (vitest `bench`) lives in PerfBudget.bench.ts and is
 * intentionally NOT part of `npm test` so it can never flake the unit gate.
 */

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");

// Fixed load. Small enough to run fast on the tiny fixture network, large
// enough that a real algorithmic regression shows up.
const VEHICLE_COUNT = 10;
const PATHFINDING_CALLS = 200;

// Generous budgets (~5-10x typical local timing on the fixture network).
// A single full game-loop tick advancing VEHICLE_COUNT vehicles typically
// runs in well under 5ms locally; 250ms is a deliberately loose ceiling.
const TICK_BUDGET_MS = 250;
// PATHFINDING_CALLS A* searches on the fixture typically finish in a few ms;
// 2000ms is a deliberately loose ceiling that still catches a gross blow-up.
const PATHFINDING_BUDGET_MS = 2000;

describe("perf budget guard", () => {
  let network: RoadNetwork;
  let manager: VehicleManager;
  let restoreRng: () => void;
  let origVehicleCount: number;
  let origAdapterURL: string;

  beforeEach(() => {
    // Seeded RNG: reproducible placement/routing so the budget is stable.
    restoreRng = setAmbientRng(0x5eed);

    origVehicleCount = config.vehicleCount;
    origAdapterURL = config.adapterURL;
    (config as { vehicleCount: number }).vehicleCount = VEHICLE_COUNT;
    (config as { adapterURL: string }).adapterURL = "";

    network = new RoadNetwork(FIXTURE_PATH);
    manager = new VehicleManager(network, new FleetManager());
  });

  afterEach(() => {
    for (const v of manager.getVehicles()) {
      manager.stopVehicleMovement(v.id);
    }
    manager.stopLocationUpdates();
    (config as { vehicleCount: number }).vehicleCount = origVehicleCount;
    (config as { adapterURL: string }).adapterURL = origAdapterURL;
    restoreRng();
    // Belt-and-suspenders: leave the ambient Rng at the production default.
    setAmbientRng(defaultRng)();
  });

  it(`advances a full game-loop tick (${VEHICLE_COUNT} vehicles) under ${TICK_BUDGET_MS}ms`, () => {
    // Internal Vehicle objects (mutable speed/dwell) via the public registry.
    const vehicles = Array.from(manager.registry.getAll().values());
    expect(vehicles.length).toBe(VEHICLE_COUNT);

    // Activate every vehicle and give it motion so the tick does real work
    // (movement physics + edge-index maintenance + serialization), not a no-op.
    manager.setOptions({ minSpeed: 30, maxSpeed: 60, speedVariation: 0 });
    for (const v of vehicles) {
      v.speed = 40;
      v.targetSpeed = 40;
      v.dwellUntil = undefined;
      manager.startVehicleMovement(v.id, 500);
    }

    // Warm one tick (JIT + lazy init) so the measured tick is steady-state.
    manager.gameLoop.gameLoopTick();

    const start = performance.now();
    manager.gameLoop.gameLoopTick();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(TICK_BUDGET_MS);
  });

  it(`runs ${PATHFINDING_CALLS} pathfinding calls under ${PATHFINDING_BUDGET_MS}ms`, () => {
    // Deterministic, connected endpoints on the fixture network (the same
    // coordinates the RoadNetwork findRoute tests use), so every call does a
    // real A* search rather than bailing on an isolated node.
    const start = network.findNearestNode([45.5017, -73.5673]);
    const end = network.findNearestNode([45.5029, -73.5661]);

    // Warm up: prime caches + JIT.
    network.findRoute(start, end);
    network.clearRouteCache();

    const t0 = performance.now();
    for (let i = 0; i < PATHFINDING_CALLS; i++) {
      // Clear the route cache each iteration so we measure the A* search, not a
      // cache hit — otherwise a regression in the search itself would hide.
      network.clearRouteCache();
      const route = network.findRoute(start, end);
      expect(route).not.toBeNull();
    }
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(PATHFINDING_BUDGET_MS);
  });
});
