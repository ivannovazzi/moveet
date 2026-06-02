import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import type { SimulationClock } from "./SimulationClock";
import type {
  RecordingEventType,
  RecordingHeader,
  RecordingEvent,
  RecordingMetadata,
  StartOptions,
  VehicleDTO,
  VehicleSnapshot,
} from "../types";

/** Minimum position change (in degrees) to include a vehicle in a snapshot. ~1.1 meters. */
const POSITION_DELTA_THRESHOLD = 0.00001;

/** Maximum number of buffered events before a forced flush. */
const BUFFER_FLUSH_COUNT = 1000;

/** Flush interval in milliseconds. */
const BUFFER_FLUSH_INTERVAL_MS = 1000;

/**
 * Options for starting a recording in RAW mode (used by headless generation).
 *
 * Raw mode differs from the default live-capture mode in three ways:
 * 1. Event `timestamp` is a SIM-CLOCK-relative offset (clock-now minus the
 *    historical start) rather than `Date.now() - startTime` wall-clock offset.
 * 2. No position dedup — every active vehicle is captured every `vehicle` event.
 * 3. The header `startTime` is the chosen historical start and carries
 *    `generated: true`, `stepMs`, and (optionally) `seed`.
 *
 * Absolute fix time on replay/emit = `header.startTime + event.timestamp`.
 */
export interface RawRecordingOptions {
  /** Historical start of the generated window (becomes header.startTime). */
  startTime: Date;
  /** Simulated milliseconds advanced per step (written into the header). */
  stepMs: number;
  /** Sim RNG seed for reproducibility (written into the header when present). */
  seed?: number;
  /**
   * Per-vehicle source metadata (vehicleId → metadata, e.g. `{ devices: [...] }`)
   * written once into the header so replay/emit can fan out to real device ids.
   */
  vehicleMeta?: Record<string, Record<string, unknown>>;
  /**
   * Sim clock to read the current sim time from when stamping event timestamps.
   * The relative offset is `clock.now - startTime`.
   */
  clock: SimulationClock;
}

/**
 * Records simulation events to NDJSON files for later replay.
 *
 * Emits:
 * - `recording:started` — when a new recording begins
 * - `recording:stopped` — with RecordingMetadata when a recording ends
 * - `recording:error` — on write errors
 */
export class RecordingManager extends EventEmitter {
  private recording = false;
  private startTime = 0;
  private filePath = "";
  private startTimeISO = "";
  private vehicleCount = 0;
  private eventCount = 0;

  private fd: number | null = null;
  private buffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  /** Last known position per vehicle id, used for delta dedup. */
  private lastPositions: Map<string, [number, number]> = new Map();

  /**
   * Raw-mode state. When set, recording is in headless/generated mode:
   * timestamps are sim-clock-relative, position dedup is disabled, and the
   * header is back-dated to {@link RawRecordingOptions.startTime}. `null` in
   * the default live-capture mode.
   */
  private raw: RawRecordingOptions | null = null;
  /** Epoch ms of the historical start in raw mode (header.startTime). */
  private rawStartMs = 0;
  /** Largest event timestamp written so far (used for raw-mode duration). */
  private maxEventTimestamp = 0;

  constructor() {
    super();
  }

  /**
   * Begins capturing events to an NDJSON file.
   *
   * @param options - Current simulation start options (written into the header)
   * @param vehicleCount - Number of vehicles at recording start
   * @param filePath - Optional explicit file path; auto-generated if omitted
   * @param raw - Optional RAW-mode config (headless generation). When provided,
   *   timestamps are sim-clock-relative, dedup is disabled, and the header is
   *   back-dated to `raw.startTime` with `generated`/`stepMs`/`seed` set.
   */
  startRecording(
    options: StartOptions,
    vehicleCount: number,
    filePath?: string,
    raw?: RawRecordingOptions
  ): string {
    if (this.recording) {
      throw new Error("Recording already in progress");
    }

    this.raw = raw ?? null;
    this.startTime = Date.now();
    if (this.raw) {
      // In raw mode the header startTime is the chosen historical start, and the
      // sim-clock-relative baseline is that same instant.
      this.rawStartMs = this.raw.startTime.getTime();
      this.startTimeISO = this.raw.startTime.toISOString();
    } else {
      this.rawStartMs = 0;
      this.startTimeISO = new Date(this.startTime).toISOString();
    }
    this.vehicleCount = vehicleCount;
    this.eventCount = 0;
    this.maxEventTimestamp = 0;
    this.lastPositions.clear();
    this.buffer = [];

    // Determine file path
    if (filePath) {
      this.filePath = filePath;
    } else {
      const safeDate = this.startTimeISO.replace(/:/g, "-");
      const prefix = this.raw ? "moveet-generated" : "moveet";
      const fileName = `${prefix}-${safeDate}-${vehicleCount}v.ndjson`;
      this.filePath = path.join("recordings", fileName);
    }

    // Ensure directory exists
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    // Open file descriptor for synchronous writes
    this.fd = fs.openSync(this.filePath, "w");

    // Write header as first line
    const header: RecordingHeader = {
      format: "moveet-recording",
      version: 1,
      startTime: this.startTimeISO,
      vehicleCount,
      options,
    };
    if (this.raw) {
      header.generated = true;
      header.stepMs = this.raw.stepMs;
      if (this.raw.seed !== undefined) header.seed = this.raw.seed;
      if (this.raw.vehicleMeta && Object.keys(this.raw.vehicleMeta).length > 0) {
        header.vehicleMeta = this.raw.vehicleMeta;
      }
    }
    fs.writeSync(this.fd, JSON.stringify(header) + "\n");

    // Start periodic flush timer (live mode only). In raw mode the headless
    // loop drives writes synchronously and must not start a setInterval.
    if (!this.raw) {
      this.flushTimer = setInterval(() => this.flushBuffer(), BUFFER_FLUSH_INTERVAL_MS);
    }

    this.recording = true;
    this.emit("recording:started", { filePath: this.filePath });

    return this.filePath;
  }

  /**
   * Finalizes the recording file and returns metadata.
   */
  stopRecording(): RecordingMetadata {
    if (!this.recording) {
      throw new Error("No recording in progress");
    }

    // Flush remaining buffered events
    this.flushBuffer();

    // Stop flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Close file descriptor
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }

    this.recording = false;

    // Raw mode: duration is the simulated span (max sim-relative offset) so
    // replay progress bars reflect simulated time, not wall-clock generation
    // time. Live mode: elapsed wall-clock since recording began.
    const duration = this.raw ? this.maxEventTimestamp : Date.now() - this.startTime;
    this.raw = null;
    let fileSize = 0;
    try {
      fileSize = fs.statSync(this.filePath).size;
    } catch {
      // ignore
    }

    const metadata: RecordingMetadata = {
      filePath: this.filePath,
      startTime: this.startTimeISO,
      duration,
      eventCount: this.eventCount,
      fileSize,
      vehicleCount: this.vehicleCount,
    };

    this.emit("recording:stopped", metadata);
    return metadata;
  }

  /**
   * Returns whether a recording is currently in progress.
   */
  isRecording(): boolean {
    return this.recording;
  }

  /**
   * Returns milliseconds elapsed since recording started.
   * Returns 0 if not recording.
   */
  getElapsedMs(): number {
    if (!this.recording) return 0;
    return Date.now() - this.startTime;
  }

  /**
   * Captures a vehicle position snapshot, applying delta dedup.
   * Only vehicles whose position changed by more than POSITION_DELTA_THRESHOLD
   * since the last snapshot are included.
   *
   * @param vehicles - Current vehicle DTOs from the game loop tick
   */
  captureVehicleSnapshot(vehicles: VehicleDTO[]): void {
    if (!this.recording) return;

    const changed: VehicleSnapshot[] = [];

    for (const v of vehicles) {
      // RAW mode: no dedup — every active vehicle is captured every step.
      if (!this.raw) {
        const prev = this.lastPositions.get(v.id);
        if (prev) {
          const dlat = Math.abs(v.position[0] - prev[0]);
          const dlng = Math.abs(v.position[1] - prev[1]);
          if (dlat < POSITION_DELTA_THRESHOLD && dlng < POSITION_DELTA_THRESHOLD) {
            continue;
          }
        }
      }

      changed.push({
        id: v.id,
        position: [v.position[0], v.position[1]],
        speed: v.speed,
        heading: v.heading,
        edgeId: "", // VehicleDTO doesn't carry edgeId; caller can enrich if needed
        ...(v.fleetId ? { fleetId: v.fleetId } : {}),
      });

      this.lastPositions.set(v.id, [v.position[0], v.position[1]]);
    }

    if (changed.length === 0) return;

    this.recordEvent("vehicle", { vehicles: changed } as unknown as Record<string, unknown>);
  }

  /**
   * Records a single discrete event.
   *
   * @param type - The event type
   * @param data - Arbitrary event payload
   */
  recordEvent(type: RecordingEventType, data: Record<string, unknown>): void {
    if (!this.recording) return;

    // RAW mode: stamp a SIM-CLOCK-relative offset (sim-now minus historical
    // start) so `header.startTime + event.timestamp` reconstructs absolute sim
    // time. Live mode: wall-clock offset since recording began.
    const timestamp = this.raw
      ? this.raw.clock.getState().currentTime.getTime() - this.rawStartMs
      : Date.now() - this.startTime;

    const event: RecordingEvent = {
      timestamp,
      type,
      data,
    };

    this.buffer.push(JSON.stringify(event));
    this.eventCount++;
    if (timestamp > this.maxEventTimestamp) this.maxEventTimestamp = timestamp;

    if (this.buffer.length >= BUFFER_FLUSH_COUNT) {
      this.flushBuffer();
    }
  }

  /**
   * Writes all buffered event lines to the file.
   */
  private flushBuffer(): void {
    if (this.buffer.length === 0 || this.fd === null) return;

    const chunk = this.buffer.join("\n") + "\n";
    this.buffer = [];
    fs.writeSync(this.fd, chunk);
  }
}
