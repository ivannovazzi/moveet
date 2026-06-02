import type { VehicleUpdate } from "../types";
import type { PublishResult } from "../plugins/types";
import { ReplayEmitter } from "./ReplayEmitter";
import { createLogger } from "../utils/logger";

const logger = createLogger("emitJob");

export type EmitState = "idle" | "emitting" | "done" | "error";

export interface EmitStatus {
  state: EmitState;
  jobId?: string;
  emitted: number;
  total?: number;
  pct?: number;
  startedAt?: number;
  error?: string;
}

export interface StartEmitParams {
  recordingId: number;
  realism: "on" | "off";
  seed?: number;
}

export interface EmitJobDeps {
  /** Base URL of the simulator (e.g. config.simulatorUrl). */
  simulatorUrl: string;
  /** Real sink fan-out — PluginManager.publishToSinks. */
  publish: (updates: VehicleUpdate[]) => Promise<PublishResult>;
  /** Configured REALISM_CONFIG knobs; the realism-on path forces enabled:true. */
  realismConfig: Record<string, unknown>;
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

/**
 * Convert a fetch Response body (a Web ReadableStream) into an async iterable of
 * decoded text chunks that {@link ReplayEmitter} can split into NDJSON lines.
 */
async function* streamToText(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Single-slot background emit job. The adapter has no WS to the UI, so progress
 * is exposed via {@link getStatus} (polled by `GET /replay/emit/status`).
 *
 * Only one emit may run at a time — {@link start} returns `false` while a job is
 * in flight so the route can answer 409.
 */
export class EmitJobRunner {
  private readonly deps: EmitJobDeps;
  private status: EmitStatus = { state: "idle", emitted: 0 };

  constructor(deps: EmitJobDeps) {
    this.deps = deps;
  }

  getStatus(): EmitStatus {
    return { ...this.status };
  }

  isRunning(): boolean {
    return this.status.state === "emitting";
  }

  /**
   * Start a background emit. Returns the new jobId, or `null` if a job is
   * already running (the route maps `null` → 409).
   */
  start(params: StartEmitParams): string | null {
    if (this.isRunning()) return null;
    const jobId = `emit-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    this.status = { state: "emitting", jobId, emitted: 0, startedAt: Date.now() };
    // Fire-and-forget; status reflects progress/outcome.
    void this.execute(jobId, params);
    return jobId;
  }

  private async execute(jobId: string, params: StartEmitParams): Promise<void> {
    const fetchFn = this.deps.fetchFn ?? fetch;
    const url = `${this.deps.simulatorUrl}/recordings/${params.recordingId}/download`;
    try {
      const res = await fetchFn(url);
      if (!res.ok) {
        throw new Error(`Simulator returned ${res.status} for ${url}`);
      }
      if (!res.body) {
        throw new Error(`Recording response had no body: ${url}`);
      }

      const realism = params.realism === "on";
      const emitter = new ReplayEmitter({
        source: streamToText(res.body),
        realism,
        seed: params.seed,
        // Force the engine enabled when realism:"on" (the intent of the flag),
        // merged over the configured REALISM_CONFIG knobs.
        realismConfig: realism ? { ...this.deps.realismConfig, enabled: true } : undefined,
        publish: this.deps.publish,
        onProgress: (processed) => {
          this.status.emitted = processed;
        },
      });

      await emitter.run();
      this.status = {
        state: "done",
        jobId,
        emitted: emitter.emitted,
        total: emitter.emitted,
        pct: 100,
        startedAt: this.status.startedAt,
      };
      logger.info({ jobId, emitted: emitter.emitted }, "Emit job complete");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.status = {
        state: "error",
        jobId,
        emitted: this.status.emitted,
        startedAt: this.status.startedAt,
        error: message,
      };
      logger.error({ jobId, err }, "Emit job failed");
    }
  }
}
