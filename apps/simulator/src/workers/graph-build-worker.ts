/**
 * One-shot worker thread that builds a road-network graph off the main thread.
 *
 * Used by a map switch (`RoadNetwork.loadOffThread`): reading and parsing the
 * GeoJSON and running {@link GraphBuilder} (graph, base costs, turn bans, ALT
 * landmarks) is seconds of CPU on a city-sized map, which on the main thread
 * would stall every request and WebSocket frame for that long.
 *
 * Settings arrive in `workerData` ({@link GraphBuildWorkerData}), already
 * resolved from the environment on the main thread: like the pathfinding
 * worker, this bundle must not import the zod/dotenv/pino config module.
 *
 * Protocol (worker -> main, in this order):
 *   { type: "graph", graph: PackedGraph }            typed arrays transferred
 *   { type: "chunk", list: keyof PackedLists, items } node ids, POIs, signs, features
 *   { type: "done" }
 * or, on any failure, { type: "error", message }. The main thread then
 * terminates the worker.
 *
 * After "graph", the worker sends one message per "next" it receives from the
 * main thread. A MessagePort delivers everything already queued in a single
 * event-loop turn, so pushing all chunks at once would deserialize them back to
 * back and stall the main thread exactly as one big message would; pulling them
 * one at a time lets the event loop run between chunks.
 *
 * It is bundled by esbuild into `dist/workers/graph-build-worker.cjs` (see
 * scripts/build-worker.mjs) for the same reason as the pathfinding worker:
 * plain Node cannot resolve the extensionless ESM imports it shares with the
 * main thread.
 */

import { parentPort, workerData } from "worker_threads";
import fs from "fs";
import type { FeatureCollection } from "geojson";
import type { HighwayType } from "../types";
import { GraphBuilder } from "../modules/roadnetwork/GraphBuilder";
import { packGraph, type PackedGraph, type PackedLists } from "../modules/roadnetwork/packedGraph";

export interface GraphBuildWorkerData {
  geojsonPath: string;
  landmarkCount: number;
  freeFlowFactors: Record<HighwayType, number>;
  speedProfileRatio: number | null;
}

export type GraphBuildWorkerMessage =
  | { type: "graph"; graph: PackedGraph }
  | { type: "chunk"; list: keyof PackedLists; items: unknown[] }
  | { type: "done" }
  | { type: "error"; message: string };

/**
 * Items per message, by list. Each message is deserialized on the main thread
 * in one go, so chunks keep that at a few milliseconds even on large maps.
 */
const CHUNK_SIZE: Record<keyof PackedLists, number> = {
  nodeIds: 20_000,
  pois: 4000,
  speedLimits: 4000,
  features: 2000,
};

function* chunkMessages(lists: PackedLists): Generator<GraphBuildWorkerMessage, void> {
  for (const list of Object.keys(CHUNK_SIZE) as Array<keyof PackedLists>) {
    const items: unknown[] = lists[list];
    const size = CHUNK_SIZE[list];
    for (let i = 0; i < items.length; i += size) {
      yield { type: "chunk", list, items: items.slice(i, i + size) };
    }
  }
}

if (parentPort) {
  const port = parentPort;
  const data = workerData as GraphBuildWorkerData;
  try {
    const raw = JSON.parse(fs.readFileSync(data.geojsonPath, "utf8")) as FeatureCollection;
    const built = new GraphBuilder({
      landmarkCount: data.landmarkCount,
      freeFlowFactors: data.freeFlowFactors,
      speedProfileRatio: data.speedProfileRatio,
    }).build(raw);
    const { graph, lists, transfer } = packGraph(built);
    const pending = chunkMessages(lists);
    port.on("message", (msg: unknown) => {
      if (msg !== "next") return;
      const next = pending.next();
      port.postMessage(
        next.done ? ({ type: "done" } satisfies GraphBuildWorkerMessage) : next.value
      );
    });
    port.postMessage({ type: "graph", graph } satisfies GraphBuildWorkerMessage, transfer);
  } catch (err) {
    port.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    } satisfies GraphBuildWorkerMessage);
  }
}
