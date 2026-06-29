/**
 * Bundles the pathfinding worker into a self-contained CommonJS file at
 * dist/workers/pathfinding-worker.cjs.
 *
 * Why a separate bundle step: the worker imports the shared A* cost/heap modules
 * and the OSM-tag parsers (../modules/pathfinding/{cost,heap}, ../modules/
 * roadnetwork/types) using extensionless ESM specifiers — the same style the
 * whole codebase emits. When PathfindingPool launches the worker via
 * `new Worker(...)`, plain Node (and even tsx, which does not propagate its
 * loader into worker_threads) cannot resolve those specifiers. esbuild inlines
 * the shared modules so the worker is a single dependency-free file. We emit CJS
 * so the bundle runs regardless of the package's "type": "module" setting.
 *
 * Run by `npm run build:worker` (and chained into `build` / `pretest`). The
 * production Docker image bundles the worker the same way (see root Dockerfile).
 */

import { build } from "esbuild";
import { fileURLToPath } from "url";
import path from "path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

await build({
  entryPoints: [path.join(root, "src", "workers", "pathfinding-worker.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node26",
  packages: "external",
  outfile: path.join(root, "dist", "workers", "pathfinding-worker.cjs"),
});

console.log("Bundled dist/workers/pathfinding-worker.cjs");
