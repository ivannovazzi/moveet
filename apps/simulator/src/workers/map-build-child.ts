/**
 * Child process that runs one map build (the `apps/network` pipeline).
 *
 * The pipeline is synchronous (osmium runs through execFileSync) and parses
 * whole GeoJSON files, so it runs here rather than on the simulator's event
 * loop. `MapBuildRunner` forks this file, sends one `start` message, and
 * listens for `progress`, then `done` or `error`. Cancelling kills the whole
 * process group, osmium included.
 *
 * Bundled by `scripts/build-worker.mjs` into `dist/workers/map-build-child.mjs`
 * (the pipeline is inlined), like the pathfinding worker.
 */
import { buildMap, type BuildMapOptions } from "@moveet/network/pipeline";

export type MapBuildChildRequest = Omit<BuildMapOptions, "onProgress">;

export type MapBuildChildMessage =
  | { type: "progress"; progress: import("@moveet/network/pipeline").BuildProgress }
  | { type: "done"; result: import("@moveet/network/pipeline").BuildMapResult }
  | { type: "error"; message: string };

function send(message: MapBuildChildMessage): Promise<void> {
  return new Promise((resolve) => {
    if (!process.send) return resolve();
    process.send(message, undefined, {}, () => resolve());
  });
}

process.once("message", (msg: { type?: string; options?: MapBuildChildRequest }) => {
  if (msg?.type !== "start" || !msg.options) return;
  buildMap({ ...msg.options, onProgress: (progress) => void send({ type: "progress", progress }) })
    .then((result) => send({ type: "done", result }))
    .catch((err: unknown) =>
      send({ type: "error", message: err instanceof Error ? err.message : String(err) })
    )
    .finally(() => process.exit(0));
});

// The parent going away (crash, restart) must not leave an orphaned build.
process.on("disconnect", () => process.exit(1));
