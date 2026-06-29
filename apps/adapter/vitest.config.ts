import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "**/*.test.ts", "**/*.spec.ts", "vitest.config.ts"],
      thresholds: {
        // Global floor: the whole adapter must stay at least here.
        lines: 50,
        branches: 50,
        functions: 50,
        statements: 50,
        // Per-file floors pin the hot/critical delivery paths well above the
        // global floor, so a regression that guts one of them reddens CI even
        // while the aggregate stays green. Glob keys are matched per file.
        // Target is 80 across the board; these floors sit at or above the
        // current measured coverage and never below 80 where it is already met.
        "src/plugins/publisher.ts": {
          lines: 90,
          branches: 90,
          functions: 90,
          statements: 90,
        },
        "src/plugins/sinks/redpanda.ts": {
          lines: 88,
          // Margin below measured (~92) to absorb local/CI v8 branch variance.
          branches: 80,
          functions: 85,
          statements: 88,
        },
        "src/plugins/format/*.ts": {
          lines: 88,
          branches: 80,
          functions: 88,
          statements: 88,
        },
      },
    },
  },
});
