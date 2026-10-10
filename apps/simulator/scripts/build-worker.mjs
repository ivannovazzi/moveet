/**
 * Bundles the worker threads into self-contained CommonJS files in dist/workers:
 * pathfinding-worker.cjs (the A* pool) and graph-build-worker.cjs (builds the
 * graph for a map switch off the main thread). Also bundles the map build child
 * process into dist/workers/map-build-child.mjs.
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

for (const name of ["pathfinding-worker", "graph-build-worker"]) {
  await build({
    entryPoints: [path.join(root, "src", "workers", `${name}.ts`)],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node26",
    packages: "external",
    outfile: path.join(root, "dist", "workers", `${name}.cjs`),
  });
  console.log(`Bundled dist/workers/${name}.cjs`);
}

// The map build child process (modules/maps/MapBuildRunner forks it). It runs
// the apps/network pipeline, which is raw TypeScript in a workspace package,
// so everything is inlined (no externals but node builtins) and the result is
// one standalone ESM file that plain node runs in dev, tests and the image.
await build({
  entryPoints: [path.join(root, "src", "workers", "map-build-child.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node26",
  outfile: path.join(root, "dist", "workers", "map-build-child.mjs"),
});

console.log("Bundled dist/workers/map-build-child.mjs");
