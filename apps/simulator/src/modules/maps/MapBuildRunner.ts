import { fork } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { BuildMapResult, BuildProgress } from "@moveet/network/pipeline";
import type { MapBuildChildMessage, MapBuildChildRequest } from "../../workers/map-build-child";
import logger from "../../utils/logger";

export type { BuildMapResult, BuildProgress, MapBuildChildRequest };

/** A build in flight. */
export interface MapBuildHandle {
  /** Settles with the pipeline's result, or rejects with its error (or on cancel). */
  result: Promise<BuildMapResult>;
  /** Stops the build, killing the pipeline and any osmium it started. */
  cancel(): void;
}

/** Starts one build. Injectable so the job manager can be tested without osmium. */
export type MapBuildRunner = (
  request: MapBuildChildRequest,
  onProgress: (progress: BuildProgress) => void
) => MapBuildHandle;

export class MapBuildCancelledError extends Error {
  constructor() {
    super("Build cancelled");
    this.name = "MapBuildCancelledError";
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The bundled child script (`npm run build:worker`), resolved across run
 * modes like the pathfinding worker:
 *  - dev/tsx/vitest: src/modules/maps -> ../../../dist/workers
 *  - bundled dist/index.js: dist -> dist/workers
 */
export function resolveChildScript(): string {
  const candidates = [
    path.join(__dirname, "..", "..", "..", "dist", "workers", "map-build-child.mjs"),
    path.join(__dirname, "workers", "map-build-child.mjs"),
    path.join(__dirname, "..", "workers", "map-build-child.mjs"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

/** Lines of child output kept to explain a crash. */
const TAIL_LINES = 20;

/**
 * Runs each build in a forked child process (its own process group), so the
 * synchronous pipeline never blocks the simulator's event loop and a cancel
 * can kill osmium along with it.
 */
export function createForkRunner(scriptPath = resolveChildScript()): MapBuildRunner {
  return (request, onProgress) => {
    const child = fork(scriptPath, [], {
      // Own process group: `kill(-pid)` reaches osmium too.
      detached: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      serialization: "json",
    });
    let cancelled = false;
    const tail: string[] = [];
    const collect = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/[\r\n]+/)) {
        if (!line.trim()) continue;
        logger.debug(`[map build] ${line}`);
        tail.push(line);
        if (tail.length > TAIL_LINES) tail.shift();
      }
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    const killGroup = (signal: NodeJS.Signals) => {
      if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    };

    const result = new Promise<BuildMapResult>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      child.on("message", (msg: MapBuildChildMessage) => {
        if (msg.type === "progress") onProgress(msg.progress);
        else if (msg.type === "done") settle(() => resolve(msg.result));
        else if (msg.type === "error") settle(() => reject(new Error(msg.message)));
      });
      child.on("error", (err) => settle(() => reject(err)));
      // `close`, not `exit`: by then every IPC message has been delivered.
      child.on("close", (code, signal) => {
        if (cancelled) return settle(() => reject(new MapBuildCancelledError()));
        const detail = tail.length ? `: ${tail.slice(-3).join(" | ")}` : "";
        settle(() =>
          reject(new Error(`Map build process exited (${signal ?? `code ${code}`})${detail}`))
        );
      });
    });

    child.send({ type: "start", options: request });

    return {
      result,
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        killGroup("SIGTERM");
        // osmium normally dies on SIGTERM; make sure nothing lingers.
        setTimeout(() => killGroup("SIGKILL"), 2000).unref();
      },
    };
  };
}
