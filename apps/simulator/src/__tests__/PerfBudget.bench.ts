import { describe, test, beforeAll } from "vitest";
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
 *
 * Vitest 5 rewrote the benchmark API. `bench` is no longer a module-level
 * import that declares its own task type; it is a fixture on the test context
 * that REGISTERS a benchmark, which you then `.run()`. So each benchmark now
 * lives inside an ordinary `test()`. Two consequences worth knowing:
 *
 *   - `bench.skip` / `bench.only` are gone (use the `test` modifiers).
 *   - Nothing prints the numbers for you any more. Vitest 4's benchmark
 *     reporter printed an hz/mean table automatically; in 5 the table is only
 *     produced by `bench.compare()`, which is for racing implementations of the
 *     SAME thing against each other. These two measure different hot paths, so
 *     comparing them would be meaningless — instead `.run()` hands back the
 *     statistics and `report()` below prints them. Keeping the output is the
 *     whole point of the file.
 */

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");
const VEHICLE_COUNT = 10;

/**
 * Prints one benchmark's headline statistics, roughly as Vitest 4's benchmark
 * reporter did. Writes to the real stdout rather than `console.log` because
 * Vitest's bench mode swallows intercepted console output, and a benchmark that
 * prints nothing is a benchmark nobody reads.
 */
function report(name: string, result: { latency: { mean: number }; throughput: { mean: number } }) {
  const opsPerSecond = result.throughput.mean.toFixed(1);
  const meanMs = result.latency.mean.toFixed(4);
  process.stdout.write(`  ${name}: ${opsPerSecond} ops/s (mean ${meanMs} ms)\n`);
}

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

  test("single A* findRoute (cold cache)", async ({ bench }) => {
    const name = "single A* findRoute (cold cache)";
    report(
      name,
      await bench(name, () => {
        network.clearRouteCache();
        network.findRoute(start, end);
      }).run()
    );
  });

  test(`full game-loop tick (${VEHICLE_COUNT} vehicles)`, async ({ bench }) => {
    const name = `full game-loop tick (${VEHICLE_COUNT} vehicles)`;
    report(
      name,
      await bench(name, () => {
        manager.gameLoop.gameLoopTick();
      }).run()
    );
  });
});
