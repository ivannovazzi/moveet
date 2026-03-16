/**
 * Pool of worker threads for parallel A* pathfinding.
 *
 * Distributes route requests across N workers via round-robin, each worker
 * holding its own copy of the road-network graph. The main thread only
 * sends lightweight { startId, endId } messages and receives { edgeIds, distance }.
 */

import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import fs from "fs";
import path from "path";
import os from "os";
import logger from "../utils/logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Default per-request timeout in milliseconds (30 seconds). */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface PathfindingResult {
  edgeIds: string[];
  distance: number;
}

interface PendingRequest {
  resolve: (value: PathfindingResult | null) => void;
  reject: (reason: Error) => void;
  workerIndex: number;
  timer: ReturnType<typeof setTimeout>;
}

export interface PathfindingPoolOptions {
  poolSize?: number;
  requestTimeoutMs?: number;
}

export class PathfindingPool {
  private workers: Worker[] = [];
  private pending: Map<number, PendingRequest> = new Map();
  private nextId = 0;
  private nextWorker = 0;
  private shutdownFlag = false;
  private requestTimeoutMs: number;

  constructor(geojsonPath: string, options?: PathfindingPoolOptions | number) {
    // Support legacy signature: constructor(geojsonPath, poolSize?)
    let poolSize: number | undefined;
    if (typeof options === "number") {
      poolSize = options;
      this.requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
    } else {
      poolSize = options?.poolSize;
      this.requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    }

    const size = poolSize ?? Math.min(os.cpus().length, 4);

    // Resolve worker path: prefer .ts (dev/tsx/vitest), fall back to .js (compiled)
    const tsPath = path.join(__dirname, "..", "workers", "pathfinding-worker.ts");
    const jsPath = path.join(__dirname, "..", "workers", "pathfinding-worker.js");
    const workerPath = fs.existsSync(tsPath) ? tsPath : jsPath;

    for (let i = 0; i < size; i++) {
      const worker = new Worker(workerPath, {
        workerData: { geojsonPath },
      });

      worker.on("message", (msg: { type: string; id: number; route: PathfindingResult | null }) => {
        if (msg.type === "result") {
          const req = this.pending.get(msg.id);
          if (req) {
            clearTimeout(req.timer);
            this.pending.delete(msg.id);
            req.resolve(msg.route);
          }
        }
      });

      worker.on("error", (err) => {
        logger.error(`Pathfinding worker ${i} error: ${err.message}`);
        this.rejectPendingForWorker(i, `Pathfinding worker ${i} crashed: ${err.message}`);
      });

      worker.on("exit", (code) => {
        if (!this.shutdownFlag && code !== 0) {
          logger.error(`Pathfinding worker ${i} exited with code ${code}`);
          this.rejectPendingForWorker(i, `Pathfinding worker ${i} exited with code ${code}`);
        }
      });

      this.workers.push(worker);
    }
  }

  /**
   * Reject all pending requests that were dispatched to a specific worker.
   */
  private rejectPendingForWorker(workerIndex: number, reason: string): void {
    for (const [id, req] of this.pending) {
      if (req.workerIndex === workerIndex) {
        clearTimeout(req.timer);
        this.pending.delete(id);
        req.reject(new Error(reason));
      }
    }
  }

  /**
   * Route a pathfinding request to a worker and return the result.
   */
  public findRoute(
    startId: string,
    endId: string,
    incidentEdges?: Map<string, number>,
    restrictedHighways?: string[]
  ): Promise<PathfindingResult | null> {
    if (this.workers.length === 0) {
      return Promise.resolve(null);
    }

    return new Promise<PathfindingResult | null>((resolve, reject) => {
      const id = this.nextId++;
      const workerIndex = this.nextWorker % this.workers.length;
      this.nextWorker++;

      const timer = setTimeout(() => {
        const req = this.pending.get(id);
        if (req) {
          this.pending.delete(id);
          req.reject(new Error(`Pathfinding request ${id} timed out after ${this.requestTimeoutMs}ms`));
        }
      }, this.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, workerIndex, timer });

      const worker = this.workers[workerIndex];
      const msg: Record<string, unknown> = { type: "findRoute", id, startId, endId };
      if (incidentEdges) {
        msg.incidentEdges = Object.fromEntries(incidentEdges);
      }
      if (restrictedHighways && restrictedHighways.length > 0) {
        msg.restrictedHighways = restrictedHighways;
      }
      worker.postMessage(msg);
    });
  }

  /**
   * Gracefully terminate all workers and reject pending requests.
   */
  public async shutdown(): Promise<void> {
    this.shutdownFlag = true;

    // Reject any remaining pending requests
    for (const [id, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error("PathfindingPool shutting down"));
      this.pending.delete(id);
    }

    const terminations = this.workers.map((w) => w.terminate());
    await Promise.all(terminations);
    this.workers = [];
  }
}
