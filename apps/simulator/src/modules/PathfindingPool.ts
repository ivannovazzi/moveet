/**
 * Pool of worker threads for parallel A* pathfinding.
 *
 * Distributes route requests across N workers via round-robin, each worker
 * holding its own copy of the road-network graph. The main thread only
 * sends lightweight { startId, endId } messages and receives { edgeIds, distance }.
 */

import { Worker } from "worker_threads";
import fs from "fs";
import path from "path";
import os from "os";
import logger from "../utils/logger";

export interface PathfindingResult {
  edgeIds: string[];
  distance: number;
}

interface PendingRequest {
  resolve: (value: PathfindingResult | null) => void;
  reject: (reason: Error) => void;
}

export class PathfindingPool {
  private workers: Worker[] = [];
  private pending: Map<number, PendingRequest> = new Map();
  private nextId = 0;
  private nextWorker = 0;
  private shutdownFlag = false;

  constructor(geojsonPath: string, poolSize?: number) {
    const size = poolSize ?? Math.min(os.cpus().length, 4);

    // Resolve worker path: prefer .ts (dev/tsx/vitest), fall back to .js (compiled)
    const tsPath = path.join(__dirname, "..", "workers", "pathfinding-worker.ts");
    const jsPath = path.join(__dirname, "..", "workers", "pathfinding-worker.js");
    const workerPath = fs.existsSync(tsPath) ? tsPath : jsPath;

    // TypeScript workers need tsx loader on Node versions without native TS support
    const needsLoader = workerPath.endsWith(".ts");

    for (let i = 0; i < size; i++) {
      const worker = new Worker(workerPath, {
        workerData: { geojsonPath },
        ...(needsLoader ? { execArgv: ["--import", "tsx"] } : {}),
      });

      worker.on("message", (msg: { type: string; id: number; route: PathfindingResult | null }) => {
        if (msg.type === "result") {
          const req = this.pending.get(msg.id);
          if (req) {
            this.pending.delete(msg.id);
            req.resolve(msg.route);
          }
        }
      });

      worker.on("error", (err) => {
        logger.error(`Pathfinding worker ${i} error: ${err.message}`);
        // Reject all pending requests on this worker
        // (we can't easily know which pending requests belong to this worker,
        // so we let the timeout / caller handle retries)
      });

      worker.on("exit", (code) => {
        if (!this.shutdownFlag && code !== 0) {
          logger.error(`Pathfinding worker ${i} exited with code ${code}`);
        }
      });

      this.workers.push(worker);
    }
  }

  /**
   * Route a pathfinding request to a worker and return the result.
   */
  public findRoute(startId: string, endId: string): Promise<PathfindingResult | null> {
    if (this.workers.length === 0) {
      return Promise.resolve(null);
    }

    return new Promise<PathfindingResult | null>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });

      const worker = this.workers[this.nextWorker % this.workers.length];
      this.nextWorker++;

      worker.postMessage({ type: "findRoute", id, startId, endId });
    });
  }

  /**
   * Gracefully terminate all workers and reject pending requests.
   */
  public async shutdown(): Promise<void> {
    this.shutdownFlag = true;

    // Reject any remaining pending requests
    for (const [id, req] of this.pending) {
      req.reject(new Error("PathfindingPool shutting down"));
      this.pending.delete(id);
    }

    const terminations = this.workers.map((w) => w.terminate());
    await Promise.all(terminations);
    this.workers = [];
  }
}
