import { Worker } from "worker_threads";
import type {
  GraphBuildWorkerData,
  GraphBuildWorkerMessage,
} from "../../workers/graph-build-worker";
import { runSliced } from "../../utils/sliced";
import { workerBundlePath } from "../workerBundle";
import type { BuiltNetwork } from "./GraphBuilder";
import { unpackGraph, type PackedGraph, type PackedLists } from "./packedGraph";

export interface BuildOffThreadOptions {
  /** Worker script to run; defaults to the bundled `graph-build-worker`. Injectable for tests. */
  workerPath?: string;
}

/**
 * Builds the graph for `settings.geojsonPath` in a one-shot worker thread and
 * rebuilds it on this thread in time slices, so the event loop is never held
 * for long. The result is exactly what `new GraphBuilder(...).build(...)`
 * returns on this thread.
 *
 * Rejects when the file cannot be read or parsed, when the build throws, and
 * when the worker dies (crash, out of memory) before it has sent everything.
 */
export function buildGraphOffThread(
  settings: GraphBuildWorkerData,
  options: BuildOffThreadOptions = {}
): Promise<BuiltNetwork> {
  return new Promise<BuiltNetwork>((resolve, reject) => {
    const worker = new Worker(options.workerPath ?? workerBundlePath("graph-build-worker"), {
      workerData: settings,
    });
    let packed: PackedGraph | null = null;
    const chunks: Record<keyof PackedLists, unknown[][]> = {
      nodeIds: [],
      pois: [],
      speedLimits: [],
      features: [],
    };
    let settled = false;
    // One chunk per event-loop turn (see the protocol note in the worker).
    const requestNext = () =>
      setImmediate(() => {
        if (!settled) worker.postMessage("next");
      });

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(err);
    };

    worker.on("message", (msg: GraphBuildWorkerMessage) => {
      if (settled) return;
      switch (msg.type) {
        case "graph":
          packed = msg.graph;
          requestNext();
          break;
        case "chunk":
          chunks[msg.list].push(msg.items);
          requestNext();
          break;
        case "error":
          fail(new Error(msg.message));
          break;
        case "done": {
          settled = true;
          void worker.terminate();
          const graph = packed;
          if (!graph) {
            reject(new Error("Graph build worker finished without sending a graph"));
            break;
          }
          const lists = {
            nodeIds: chunks.nodeIds.flat(),
            pois: chunks.pois.flat(),
            speedLimits: chunks.speedLimits.flat(),
            features: chunks.features.flat(),
          } as PackedLists;
          runSliced(unpackGraph(graph, lists)).then(resolve, reject);
          break;
        }
      }
    });
    worker.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));
    worker.on("exit", (code) => {
      fail(new Error(`Graph build worker exited with code ${code} before finishing`));
    });
  });
}
