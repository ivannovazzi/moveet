import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import type { MapBuildLimits, MapJob, MapSource } from "@moveet/shared-types";
import type { MapLibrary } from "./MapLibrary";
import { directoryBytes } from "./MapLibrary";
import type { GeofabrikIndex } from "./GeofabrikIndex";
import { GeofabrikUnavailableError } from "./GeofabrikIndex";
import { MapBuildCancelledError, type MapBuildHandle, type MapBuildRunner } from "./MapBuildRunner";
import { type Bbox, bboxProblem } from "./bbox";
import logger from "../../utils/logger";

/**
 * Builds new maps from OpenStreetMap data at runtime (`POST /maps`).
 *
 * One build runs at a time, in a child process (see {@link MapBuildRunner});
 * up to `maxQueued` more wait in FIFO order and anything beyond is refused
 * with 409. Each job downloads its Geofabrik extract into the shared cache
 * (`<MAPS_DIR>/.cache`, reused by later builds in the same region), compiles
 * it into a hidden staging directory inside the library, and on success moves
 * that directory into place as a new map. Failure or cancellation removes the
 * staging and scratch directories, so nothing half-built ever shows up in
 * `GET /maps`.
 *
 * Emits `mapjob` ({@link MapJob}) on every state change and progress report.
 */

export const OSM_ATTRIBUTION =
  "© OpenStreetMap contributors, ODbL 1.0 (openstreetmap.org/copyright)";

/** A build request after body validation (see `mapBuildBodySchema`). */
export type MapBuildBody =
  | { preset: string; label?: string; buildings: boolean; activate: boolean }
  | { label: string; bbox: Bbox; geofabrik: string; buildings: boolean; activate: boolean };

export interface PresetRegion {
  bbox: Bbox;
  geofabrik: string;
  label: string;
}

/** A refused request or operation, with the HTTP status it maps to. */
export class MapBuildError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "MapBuildError";
  }
}

export interface MapBuildManagerOptions {
  library: MapLibrary;
  geofabrik: Pick<GeofabrikIndex, "get" | "covers">;
  presets: Record<string, PresetRegion>;
  runner: MapBuildRunner;
  /** Geofabrik download cache; scratch space for each job goes under `<cacheDir>/jobs`. */
  cacheDir: string;
  allowed: boolean;
  maxAreaKm2: number;
  diskQuotaBytes: number;
  maxQueued: number;
  /** Switches to a freshly built map when the request asked for it. */
  activate: (id: string) => Promise<unknown>;
  /** Finished jobs kept for `GET /maps/jobs`. */
  historySize?: number;
  newId?: () => string;
}

interface Running {
  job: MapJob;
  handle: MapBuildHandle | null;
  cancelRequested: boolean;
}

const STAGING_PREFIX = ".build-";

export class MapBuildManager extends EventEmitter<{ mapjob: [MapJob] }> {
  private readonly jobs = new Map<string, MapJob>();
  private readonly queue: MapJob[] = [];
  private running: Running | null = null;

  constructor(private readonly opts: MapBuildManagerOptions) {
    super();
    this.removeLeftovers();
  }

  get allowed(): boolean {
    return this.opts.allowed;
  }

  limits(): MapBuildLimits {
    const cacheBytes = fs.existsSync(this.opts.cacheDir) ? directoryBytes(this.opts.cacheDir) : 0;
    return {
      maxAreaKm2: this.opts.maxAreaKm2,
      diskQuotaBytes: this.opts.diskQuotaBytes,
      diskUsedBytes: this.opts.library.usedBytes(),
      cacheBytes,
      maxQueuedJobs: this.opts.maxQueued,
    };
  }

  /** Every known job, newest first. */
  list(): MapJob[] {
    return [...this.jobs.values()].reverse().map((j) => ({ ...j }));
  }

  get(id: string): MapJob | null {
    const job = this.jobs.get(id);
    return job ? { ...job } : null;
  }

  /**
   * Validates a request and queues it.
   *
   * @throws MapBuildError: 403 builds disabled, 400 bad bbox/preset/extract,
   *   422 bbox outside the extract, 409 queue full, 507 disk quota reached,
   *   503 Geofabrik index unavailable.
   */
  async submit(body: MapBuildBody): Promise<MapJob> {
    this.assertAllowed();
    const target = await this.resolve(body);
    this.assertQuota();
    const waiting = this.queue.length;
    if (this.running && waiting >= this.opts.maxQueued) {
      throw new MapBuildError(
        409,
        `A map build is running and ${waiting} more are queued (limit ${this.opts.maxQueued})`
      );
    }

    const job: MapJob = {
      id: (this.opts.newId ?? randomUUID)(),
      status: "queued",
      step: "queued",
      progress: 0,
      label: target.label,
      bbox: target.bbox,
      geofabrik: target.geofabrik,
      ...(target.preset ? { preset: target.preset } : {}),
      buildings: body.buildings,
      activate: body.activate,
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    this.queue.push(job);
    this.trimHistory();
    this.emitJob(job);
    this.pump();
    return { ...job };
  }

  /**
   * Cancels a queued or running job. A running build's process is killed and
   * its partial output removed before the job reports `cancelled`.
   *
   * @throws MapBuildError: 403 builds disabled, 404 unknown, 409 already finished.
   */
  cancel(id: string): MapJob {
    this.assertAllowed();
    const job = this.jobs.get(id);
    if (!job) throw new MapBuildError(404, `Map build job not found: ${id}`);
    if (job.status !== "queued" && job.status !== "running") {
      throw new MapBuildError(409, `Map build job ${id} already ${job.status}`);
    }
    if (job.status === "queued") {
      this.queue.splice(this.queue.indexOf(job), 1);
      this.finish(job, "cancelled");
      return { ...job };
    }
    if (this.running?.job === job && !this.running.cancelRequested) {
      this.running.cancelRequested = true;
      this.running.handle?.cancel();
    }
    return { ...job };
  }

  /** Kills a running build (graceful shutdown). */
  shutdown(): void {
    if (this.running) {
      this.running.cancelRequested = true;
      this.running.handle?.cancel();
    }
  }

  // ─── Internals ────────────────────────────────────────────────────

  private assertAllowed(): void {
    if (!this.opts.allowed) {
      throw new MapBuildError(
        403,
        "Map builds are disabled on this server (ALLOW_MAP_BUILDS=false)"
      );
    }
  }

  private assertQuota(): void {
    const used = this.opts.library.usedBytes();
    if (used >= this.opts.diskQuotaBytes) {
      const mb = (n: number) => Math.round(n / 1024 / 1024);
      throw new MapBuildError(
        507,
        `The map library uses ${mb(used)} MB of its ${mb(this.opts.diskQuotaBytes)} MB quota; ` +
          "delete a map before building another"
      );
    }
  }

  private async resolve(
    body: MapBuildBody
  ): Promise<{ label: string; bbox: Bbox; geofabrik: string; preset?: string }> {
    if ("preset" in body) {
      const preset = Object.hasOwn(this.opts.presets, body.preset)
        ? this.opts.presets[body.preset]
        : undefined;
      if (!preset) throw new MapBuildError(400, `Unknown preset: ${body.preset}`);
      const problem = bboxProblem(preset.bbox, this.opts.maxAreaKm2);
      if (problem) throw new MapBuildError(400, `Preset ${body.preset}: ${problem}`);
      return {
        label: body.label ?? preset.label,
        bbox: [...preset.bbox],
        geofabrik: preset.geofabrik,
        preset: body.preset,
      };
    }

    const problem = bboxProblem(body.bbox, this.opts.maxAreaKm2);
    if (problem) throw new MapBuildError(400, problem);
    try {
      // The index is the allowlist: only extracts it lists are ever downloaded.
      if (!(await this.opts.geofabrik.get(body.geofabrik))) {
        throw new MapBuildError(400, `Not a Geofabrik extract: ${body.geofabrik}`);
      }
      if (!(await this.opts.geofabrik.covers(body.geofabrik, body.bbox))) {
        throw new MapBuildError(
          422,
          `The bbox is not inside the ${body.geofabrik} extract; see GET /maps/geofabrik?bbox=...`
        );
      }
    } catch (err) {
      if (err instanceof GeofabrikUnavailableError) throw new MapBuildError(503, err.message);
      throw err;
    }
    return { label: body.label, bbox: body.bbox, geofabrik: body.geofabrik };
  }

  private pump(): void {
    if (this.running) return;
    const next = this.queue.shift();
    if (!next) return;
    this.running = { job: next, handle: null, cancelRequested: false };
    void this.run(this.running);
  }

  private async run(state: Running): Promise<void> {
    const { job } = state;
    const { library, cacheDir, runner } = this.opts;
    const stagingDir = path.join(library.root, `${STAGING_PREFIX}${job.id}`);
    const workDir = path.join(cacheDir, "jobs", job.id);

    job.status = "running";
    job.step = "download";
    job.startedAt = new Date().toISOString();
    this.emitJob(job);

    try {
      // The quota may have filled up while this job waited.
      this.assertQuota();
      fs.mkdirSync(cacheDir, { recursive: true });
      state.handle = runner(
        {
          geofabrik: job.geofabrik,
          bbox: job.bbox,
          cacheDir,
          workDir,
          outDir: stagingDir,
          regionName: job.preset ?? job.label,
          buildings: job.buildings,
        },
        (p) => {
          if (job.status !== "running") return;
          job.step = p.step;
          // The finalize step owns the last few percent.
          job.progress = Math.min(0.98, p.progress);
          if (p.bytesDownloaded !== undefined) job.bytesDownloaded = p.bytesDownloaded;
          if (p.totalBytes !== undefined) job.totalBytes = p.totalBytes;
          this.emitJob(job);
        }
      );
      const result = await state.handle.result;
      if (state.cancelRequested) throw new MapBuildCancelledError();

      job.step = "finalize";
      job.progress = 0.99;
      this.emitJob(job);
      const source: MapSource = job.preset
        ? { type: "preset", name: job.preset, path: job.geofabrik, bbox: job.bbox }
        : { type: "geofabrik", path: job.geofabrik, bbox: job.bbox };
      const meta = library.addBuiltMap({
        id: job.preset ?? job.label,
        label: job.label,
        stagingDir,
        source,
        bbox: result.bbox,
        featureCount: result.featureCount,
        ...(result.buildingCount !== null ? { buildingCount: result.buildingCount } : {}),
        attribution: OSM_ATTRIBUTION,
      });
      job.mapId = meta.id;
      logger.info(`Map build ${job.id} added "${meta.id}" (${result.featureCount} features)`);

      if (job.activate) {
        job.step = "activate";
        this.emitJob(job);
        try {
          await this.opts.activate(meta.id);
        } catch (err) {
          job.error = `Built, but could not activate: ${err instanceof Error ? err.message : err}`;
          logger.warn(`Map build ${job.id}: ${job.error}`);
        }
      }
      this.finish(job, "done");
    } catch (err) {
      if (state.cancelRequested || err instanceof MapBuildCancelledError) {
        logger.info(`Map build ${job.id} cancelled`);
        this.finish(job, "cancelled");
      } else {
        job.error = err instanceof Error ? err.message : String(err);
        logger.error(`Map build ${job.id} failed: ${job.error}`);
        this.finish(job, "failed");
      }
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      fs.rmSync(workDir, { recursive: true, force: true });
      this.running = null;
      this.pump();
    }
  }

  private finish(job: MapJob, status: "done" | "failed" | "cancelled"): void {
    job.status = status;
    if (status === "done") job.progress = 1;
    job.finishedAt = new Date().toISOString();
    this.emitJob(job);
  }

  private emitJob(job: MapJob): void {
    this.emit("mapjob", { ...job });
  }

  private trimHistory(): void {
    const max = this.opts.historySize ?? 50;
    if (this.jobs.size <= max) return;
    for (const [id, job] of this.jobs) {
      if (this.jobs.size <= max) break;
      if (job.status !== "queued" && job.status !== "running") this.jobs.delete(id);
    }
  }

  /** Staging and scratch directories of builds a previous process never finished. */
  private removeLeftovers(): void {
    const { library, cacheDir } = this.opts;
    try {
      for (const entry of fs.readdirSync(library.root)) {
        if (entry.startsWith(STAGING_PREFIX)) {
          fs.rmSync(path.join(library.root, entry), { recursive: true, force: true });
        }
      }
    } catch {
      // No library root yet.
    }
    fs.rmSync(path.join(cacheDir, "jobs"), { recursive: true, force: true });
    // Downloads cut short by a kill (cancel, shutdown) leave a `.part` behind.
    try {
      for (const entry of fs.readdirSync(cacheDir)) {
        if (entry.endsWith(".part")) fs.rmSync(path.join(cacheDir, entry), { force: true });
      }
    } catch {
      // No cache yet.
    }
  }
}
