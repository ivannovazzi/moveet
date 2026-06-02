import { EventEmitter } from "events";
import crypto from "crypto";
import path from "path";
import { HeadlessRunner } from "../headless/HeadlessRunner";
import { config } from "../utils/config";
import logger from "../utils/logger";
import type { RecordingMetadata } from "../types";

/** Public state of the generation job, surfaced by the status endpoint. */
export type GenerationState = "idle" | "running" | "done" | "error";

/** Parameters for a single generation job (validated request body). */
export interface GenerateJobParams {
  /** Historical start of the generated window (absolute). */
  startTime: Date;
  /** Total simulated hours (ignored when `steps` is provided). */
  hours?: number;
  /** Explicit step count (wins over `hours`). */
  steps?: number;
  /** Number of synthetic vehicles to seed. */
  vehicleCount: number;
  /** Simulated milliseconds advanced per step. */
  stepMs: number;
  /** Sim RNG seed for reproducibility. */
  seed?: number;
}

/** Snapshot returned by {@link GenerationManager.getStatus}. */
export interface GenerationStatus {
  state: GenerationState;
  jobId?: string;
  step?: number;
  totalSteps?: number;
  pct?: number;
}

/** Default seed when a request omits one. */
const DEFAULT_SEED = 12345;

/**
 * Owns the single in-flight headless-generation job and emits progress events.
 *
 * Emits:
 * - `generate:progress` — `{ jobId, step, totalSteps, pct }`
 * - `generate:complete` — `{ jobId, metadata }` (metadata = RecordingMetadata)
 * - `generate:error`    — `{ jobId, error }`
 *
 * Only one job may run at a time; {@link start} returns false (caller maps to
 * 409) when a job is already running.
 */
export class GenerationManager extends EventEmitter {
  private state: GenerationState = "idle";
  private jobId?: string;
  private step = 0;
  private totalSteps = 0;

  /** True when a job is currently running. */
  isRunning(): boolean {
    return this.state === "running";
  }

  /** Current status snapshot (for the status endpoint / reconnect). */
  getStatus(): GenerationStatus {
    if (this.state === "idle") return { state: "idle" };
    const pct = this.totalSteps > 0 ? Math.round((this.step / this.totalSteps) * 100) : 0;
    return {
      state: this.state,
      jobId: this.jobId,
      step: this.step,
      totalSteps: this.totalSteps,
      pct,
    };
  }

  /**
   * Starts a background generation job. Returns the new jobId, or `null` when a
   * job is already running (caller should respond 409).
   *
   * The job runs detached (not awaited) so the HTTP handler can return 202
   * immediately; progress and completion are reported via events.
   */
  start(params: GenerateJobParams): string | null {
    if (this.isRunning()) return null;

    const jobId = crypto.randomUUID();
    this.jobId = jobId;
    this.state = "running";
    this.step = 0;

    const stepMs = params.stepMs;
    const totalSimMs =
      params.steps !== undefined ? params.steps * stepMs : (params.hours ?? 1) * 3600 * 1000;
    this.totalSteps = Math.floor(totalSimMs / stepMs);

    const safeDate = params.startTime.toISOString().replace(/:/g, "-");
    const out = path.join(
      "recordings",
      `moveet-generated-${safeDate}-${params.vehicleCount}v.ndjson`
    );

    const runner = new HeadlessRunner({
      geojsonPath: config.geojsonPath,
      vehicles: params.vehicleCount,
      simStart: params.startTime,
      stepMs,
      totalSimMs,
      out,
      seed: params.seed ?? DEFAULT_SEED,
    });

    // Run detached; report via events.
    void this.execute(jobId, runner);

    return jobId;
  }

  private async execute(jobId: string, runner: HeadlessRunner): Promise<void> {
    try {
      const metadata: RecordingMetadata = await runner.run((step, totalSteps) => {
        this.step = step;
        this.totalSteps = totalSteps;
        const pct = totalSteps > 0 ? Math.round((step / totalSteps) * 100) : 0;
        this.emit("generate:progress", { jobId, step, totalSteps, pct });
      });

      this.state = "done";
      this.step = this.totalSteps;
      this.emit("generate:complete", { jobId, metadata });
    } catch (err) {
      this.state = "error";
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Generation job ${jobId} failed: ${message}`);
      this.emit("generate:error", { jobId, error: message });
    }
  }
}
