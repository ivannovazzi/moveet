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
        // Each floor sits a few points UNDER the current measured coverage so
        // a minor refactor does not flake CI, while still catching gross
        // regressions. Target is 80; where a file's branch coverage is already
        // below 80 the floor sits just under its current value with a TODO to
        // raise it (rather than failing CI today). Measured 2026-06-29.

        // Pathfinding core (cost split + binary heap). cost.ts branches 86.66,
        // heap.ts fully covered.
        "src/modules/pathfinding/cost.ts": {
          lines: 95,
          branches: 80,
          functions: 95,
          statements: 95,
        },
        "src/modules/pathfinding/heap.ts": {
          lines: 95,
          branches: 95,
          functions: 95,
          statements: 95,
        },
        // RoadNetwork decomposition collaborators. GraphBuilder/SpatialIndex
        // lines fully covered; branch floors sit under current.
        "src/modules/roadnetwork/GraphBuilder.ts": {
          lines: 95,
          // TODO raise to 80: branches measured 78.46 (graph-build edge cases).
          branches: 72,
          functions: 95,
          statements: 90,
        },
        "src/modules/roadnetwork/PathfindingEngine.ts": {
          lines: 95,
          branches: 85,
          functions: 90,
          statements: 90,
        },
        "src/modules/roadnetwork/SpatialIndex.ts": {
          lines: 95,
          branches: 88,
          functions: 95,
          statements: 95,
        },
        "src/modules/roadnetwork/types.ts": {
          lines: 95,
          branches: 88,
          functions: 95,
          statements: 95,
        },
        // RoadNetwork facade (still owns derived-collection caches + search).
        "src/modules/RoadNetwork.ts": {
          lines: 90,
          // TODO raise to 80: branches measured 78.78.
          branches: 74,
          functions: 88,
          statements: 88,
        },
        // RouteManager: routes/waypoints, pathfinding calls, movement physics.
        "src/modules/RouteManager.ts": {
          lines: 88,
          // TODO raise to 80: branches measured 79.22.
          branches: 74,
          functions: 82,
          statements: 85,
        },
        // VehicleManager facade.
        "src/modules/VehicleManager.ts": {
          lines: 86,
          // TODO raise to 80: branches measured 78.57.
          branches: 74,
          functions: 75,
          statements: 85,
        },
        // WS per-client fan-out engine (the valuable, reused logic).
        "src/modules/ws/ClientFanout.ts": {
          lines: 95,
          branches: 88,
          functions: 95,
          statements: 90,
        },
      },
    },
    include: ["**/*.test.ts", "**/*.spec.ts"],
    exclude: ["node_modules", "dist"],
  },
});
