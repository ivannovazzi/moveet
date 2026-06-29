import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "**/*.test.ts", "**/*.spec.ts", "vitest.config.ts"],
      thresholds: {
        // Global floor: the whole simulator must stay at least here.
        lines: 50,
        branches: 50,
        functions: 50,
        statements: 50,
        // Per-file floors pin the hot/critical simulation paths well above the
        // global floor, so a regression that guts one of them reddens CI even
        // while the aggregate stays green. Glob keys are matched per file.
        //
        // Floors sit ~8-12 points UNDER the locally-measured coverage
        // (2026-06-29). The margin absorbs the real local/CI variance in v8
        // branch accounting (observed up to ~5 points lower on CI) so the
        // floors guard against gross regressions without flaking. Raise them as
        // the modules' tests deepen.

        // Pathfinding core (cost split + binary heap).
        "src/modules/pathfinding/cost.ts": {
          lines: 90,
          branches: 76,
          functions: 90,
          statements: 90,
        },
        "src/modules/pathfinding/heap.ts": {
          lines: 90,
          branches: 88,
          functions: 90,
          statements: 90,
        },
        // RoadNetwork decomposition collaborators.
        "src/modules/roadnetwork/GraphBuilder.ts": {
          lines: 88,
          branches: 68,
          functions: 90,
          statements: 88,
        },
        "src/modules/roadnetwork/PathfindingEngine.ts": {
          lines: 88,
          branches: 78,
          functions: 84,
          statements: 88,
        },
        "src/modules/roadnetwork/SpatialIndex.ts": {
          lines: 90,
          branches: 80,
          functions: 90,
          statements: 90,
        },
        "src/modules/roadnetwork/types.ts": {
          lines: 90,
          branches: 80,
          functions: 90,
          statements: 90,
        },
        // RoadNetwork facade (still owns derived-collection caches + search).
        "src/modules/RoadNetwork.ts": {
          lines: 84,
          branches: 66,
          functions: 82,
          statements: 84,
        },
        // RouteManager: routes/waypoints, pathfinding calls, movement physics.
        "src/modules/RouteManager.ts": {
          lines: 80,
          branches: 66,
          functions: 76,
          statements: 80,
        },
        // VehicleManager facade.
        "src/modules/VehicleManager.ts": {
          lines: 80,
          branches: 66,
          functions: 70,
          statements: 80,
        },
        // WS per-client fan-out engine (the valuable, reused logic).
        "src/modules/ws/ClientFanout.ts": {
          lines: 88,
          branches: 80,
          functions: 90,
          statements: 88,
        },
      },
    },
    include: ["**/*.test.ts", "**/*.spec.ts"],
    exclude: ["node_modules", "dist"],
  },
});
