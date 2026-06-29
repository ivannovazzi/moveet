import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/index.ts",
        "src/cli.ts",
        // Thin orchestrators / interactive prompts: exercised end-to-end, not
        // unit-tested. The pure pipeline functions they call are covered.
        "src/commands/prepare.ts",
      ],
      // Floor that the current suite clears; tests cover the pure
      // build*Args / *Network functions, while thin I/O wrappers
      // (download streaming, osmium exec, prepare orchestration) are
      // exercised manually. Raise these as wrapper coverage grows.
      thresholds: {
        statements: 55,
        branches: 45,
        functions: 55,
        lines: 55,
      },
    },
  },
});
