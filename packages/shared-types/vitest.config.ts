import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/__tests__/**"],
      // shared-types is (currently) pure type declarations — there is no
      // runtime code for v8 to instrument, so coverage is structurally 0/0.
      // The thresholds are a guardrail floor: if runtime code (helpers, type
      // guards, enums) is ever added here, raise these to require it be tested.
      thresholds: {
        statements: 0,
        branches: 0,
        functions: 0,
        lines: 0,
      },
    },
  },
});
