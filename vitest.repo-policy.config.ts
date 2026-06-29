import { defineConfig } from "vitest/config";

// Root-level Vitest config for repo-policy tests only. These assert
// cross-cutting repository invariants (ESM config, workspace layout) that read
// repo infrastructure files. Kept OUT of the per-app suites so an infra/CI
// refactor reddens this dedicated check rather than an app's unit tests.
// Run via `npm run test:repo`.
export default defineConfig({
  test: {
    include: ["tests/repo-policy/**/*.test.ts"],
    // No coverage here: this set exercises config files, not product code.
  },
});
