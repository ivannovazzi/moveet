import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { builtinModules } from "module";

/**
 * How configuration reaches a pathfinding worker.
 *
 * `PATHFINDING_LANDMARKS` is parsed once by the zod schema in `utils/config.ts`,
 * but the worker runs as a self-contained esbuild bundle that must NOT import
 * that module — pulling in zod/dotenv/pino would balloon the bundle and drag a
 * dotenv/logger boot into every worker thread. So the resolved number travels in
 * `workerData`. These tests pin both halves of that contract:
 *
 *  1. `PathfindingPool` actually puts the count in `workerData` (Worker mocked).
 *  2. The built bundle still requires nothing but Node builtins.
 */

// Hoisted so the vi.mock factory (which is hoisted above the imports) can see it.
const { workerSpawns } = vi.hoisted(() => ({
  workerSpawns: [] as Array<{ workerPath: string; options: { workerData?: unknown } }>,
}));

vi.mock("worker_threads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("worker_threads")>();
  // Imported inside the factory: the factory is hoisted above this file's own
  // imports, so it cannot touch their bindings yet.
  const { EventEmitter } = await import("events");
  class RecordingWorker extends EventEmitter {
    postMessage = vi.fn();
    terminate = vi.fn().mockResolvedValue(0);
    constructor(workerPath: string | URL, options: { workerData?: unknown } = {}) {
      super();
      workerSpawns.push({ workerPath: String(workerPath), options });
    }
  }
  return { ...actual, Worker: RecordingWorker };
});

import { PathfindingPool } from "../../modules/PathfindingPool";
import { DEFAULT_LANDMARK_COUNT } from "../../modules/pathfinding/landmarks";
import type { PathfindingWorkerData } from "../../workers/pathfinding-worker";

const geojsonPath = path.join(__dirname, "..", "fixtures", "test-network.geojson");

function spawnedWorkerData(): PathfindingWorkerData[] {
  return workerSpawns.map((s) => s.options.workerData as PathfindingWorkerData);
}

describe("PathfindingPool → worker bootstrap (workerData)", () => {
  beforeEach(() => {
    workerSpawns.length = 0;
  });

  it("gives every worker the geojson path and the resolved landmark count", async () => {
    const pool = new PathfindingPool(geojsonPath, { poolSize: 2, landmarkCount: 7 });

    expect(workerSpawns).toHaveLength(2);
    for (const data of spawnedWorkerData()) {
      expect(data.geojsonPath).toBe(geojsonPath);
      expect(data.landmarkCount).toBe(7);
    }

    await pool.shutdown();
  });

  it("passes an explicit 0 through instead of falling back to the default", async () => {
    // 0 disables ALT preprocessing entirely; a `||` fallback anywhere on this
    // path would silently re-enable it.
    const pool = new PathfindingPool(geojsonPath, { poolSize: 1, landmarkCount: 0 });

    expect(spawnedWorkerData()[0].landmarkCount).toBe(0);

    await pool.shutdown();
  });

  it("falls back to the module default under the legacy (geojsonPath, poolSize) signature", async () => {
    const pool = new PathfindingPool(geojsonPath, 1);

    expect(spawnedWorkerData()[0].landmarkCount).toBe(DEFAULT_LANDMARK_COUNT);

    await pool.shutdown();
  });
});

// ─── The bundle must stay dependency-free ─────────────────────────────

describe("the built pathfinding worker bundle", () => {
  // Built by `npm run build:worker`, which `pretest` chains before vitest.
  const bundlePath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "dist",
    "workers",
    "pathfinding-worker.cjs"
  );

  it("requires nothing but Node builtins", () => {
    expect(fs.existsSync(bundlePath), `${bundlePath} missing — run "npm run build:worker"`).toBe(
      true
    );
    const source = fs.readFileSync(bundlePath, "utf8");

    const required = [
      ...new Set(
        [...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) =>
          m[1].replace(/^node:/, "")
        )
      ),
    ];
    expect(required.length).toBeGreaterThan(0);
    const thirdParty = required.filter((id) => !builtinModules.includes(id));
    expect(thirdParty, `worker bundle pulled in ${thirdParty.join(", ")}`).toEqual([]);
  });

  it("contains no trace of the zod/dotenv/pino config module", () => {
    const source = fs.readFileSync(bundlePath, "utf8");

    for (const marker of ["zod", "dotenv", "pino", "Simulator config"]) {
      expect(source.includes(marker), `worker bundle mentions "${marker}"`).toBe(false);
    }
    // Sanity check that this is the real bundle and not an empty file.
    expect(source).toContain("buildLandmarkIndex");
  });
});
