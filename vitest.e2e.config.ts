import { defineConfig } from "vitest/config";

// Root-level Vitest config for the docker-compose black-box smoke E2E ONLY.
//
// This is intentionally SEPARATE from every app's unit suite and from the
// repo-policy config: it boots the published images with docker compose, so it
// is slow, needs a Docker daemon, and must NEVER gate the unit `verify` job or
// be a dependency of `npm test`. It runs only via `npm run test:e2e` (and its
// own opt-in CI job). See tests/e2e/README.md for how to run it.
export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.e2e.test.ts"],
    // Booting + polling the stack and watching a vehicle move takes a while;
    // give each hook/test plenty of headroom. The test tears the stack down in
    // afterAll regardless of outcome.
    hookTimeout: 240_000,
    testTimeout: 120_000,
    // One stack at a time — these tests share host ports 5010/5011/5012.
    fileParallelism: false,
    pool: "forks",
  },
});
