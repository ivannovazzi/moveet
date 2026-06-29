import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "src/test/",
        "**/*.d.ts",
        "**/*.config.*",
        "**/mockData",
        "**/*.test.{ts,tsx}",
      ],
      thresholds: {
        // Global floor: the whole UI must stay at least here.
        lines: 50,
        branches: 50,
        functions: 50,
        statements: 50,
        // Per-file floors pin the hot/critical modules well above the global
        // floor, so a regression that guts one of them reddens CI even while
        // the aggregate stays green. Glob keys are matched per file. Target is
        // 80; the API transport segments and road-culling are fully covered, so
        // these floors sit at 90 with headroom.
        "src/utils/client/*.ts": {
          lines: 90,
          branches: 90,
          functions: 90,
          statements: 90,
        },
        "src/components/Map/components/roadCulling.ts": {
          lines: 90,
          branches: 90,
          functions: 90,
          statements: 90,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
