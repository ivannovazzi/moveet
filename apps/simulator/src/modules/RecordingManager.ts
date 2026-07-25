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
 * Default keyframe cadence, in milliseconds of RECORDING TIME.
 *
 * "Recording time" is the axis every `RecordingEvent.timestamp` lives on and
 * the axis `ReplayManager.seekTo()` takes its argument in. For RAW/generated
 * recordings that axis IS simulated time (see {@link RawRecordingOptions}:
 * timestamps are `clock.now - startTime`), which is what the keyframe feature
 * is primarily for — long fast-forwarded historical windows. For live capture
 * the axis is wall-clock-since-record-start, which for a live run advances at
 * the same rate as simulated time.
 *
 * 30 s is a deliberate middle ground: a 1-hour recording gains ~120 keyframe
 * lines (negligible next to ~36 000 vehicle-batch lines at the 100 ms recording
 * batch cadence), while a seek never has to roll forward more than ~300 event
 * lines regardless of how long the session ran.
 *
 * FOLLOW-UP: this belongs in the zod `envSchema` in `src/utils/config.ts` as
 * e.g. `RECORDING_KEYFRAME_INTERVAL_MS` so it gets validation, a default and a
 * `logConfig()` line. It is a module constant for now; `RecordingManager`
 * accepts a per-instance override via its constructor so wiring it to config
 * later is a one-line change at the construction site.
 */
const KEYFRAME_INTERVAL_MS = 30_000;

/**
 * Full simulation state as of a point in the recording, sufficient to resume
 * rendering without replaying any earlier line.
 *
 * Everything here is stored in exactly the payload shape the corresponding
 * `RecordingEvent.data` carried, so re-emitting a keyframe produces output
 * indistinguishable from having replayed every earlier event.
 */
export interface KeyframeState {
  /**
   * Last known snapshot of EVERY vehicle observed so far, not just the ones
   * that moved recently. This is the piece that makes seeking correct at all:
   * live recordings dedup unchanged positions away, so a vehicle parked since
   * minute 2 has no line anywhere near minute 40 and would otherwise be
   * missing from the map after a seek.
   */
  vehicles: VehicleSnapshot[];
  /**
   * Last `direction` payload per vehicle that still has an active route
   * (removed again on `route:completed`, matching what the UI does). Carries
   * the drawn route polyline / waypoints, which no vehicle snapshot contains.
   */
  directions: Record<string, unknown>[];
  /**
   * Payload of every incident created and not yet cleared. Incidents are
   * created/cleared by discrete events that may be hours apart, so they are
   * unrecoverable from a window of recent lines.
   */
  incidents: Record<string, unknown>[];
  /**
   * Payload of the most recent `heatzone` event, or `null` if none was
   * recorded yet. The heatzones channel is a whole-collection replace, so the
   * latest payload alone is the complete state.
   */
  heatzones: Record<string, unknown> | null;
}

/**
 * A periodic full-state keyframe line in the NDJSON recording.
 *
 * Deliberately NOT a `RecordingEvent`: `type` is `"keyframe"`, which is not a
 * member of `RecordingEventType`, so every existing consumer that switches on
 * `event.type` (`ReplayManager.emitRecordingEvent`, `convertRecordingToScenario`)
 * already falls through to its `default` branch and ignores the line. Older
 * recordings simply contain no keyframe lines, and replay falls back to
 * folding from the start of the file.
 */
export interface RecordingKeyframe {
  timestamp: number;
  type: "keyframe";
  state: KeyframeState;
}

/**
 * Running fold of the recording's render state.
 *
 * Shared by the writer (RecordingManager, to emit keyframes) and the reader
 * (ReplayManager, to roll a keyframe forward to an exact seek target) so both
 * sides interpret events identically by construction — if they diverged, a
 * keyframe seek and a replay-from-start seek would disagree.
 */
export class KeyframeStateAccumulator {
  private vehicles = new Map<string, VehicleSnapshot>();
  private directions = new Map<string, Record<string, unknown>>();
  private incidents = new Map<string, Record<string, unknown>>();
  private heatzones: Record<string, unknown> | null = null;

  /** Drops all accumulated state. */
  clear(): void {
    this.vehicles.clear();
    this.directions.clear();
    this.incidents.clear();
    this.heatzones = null;
  }

  /** Replaces the accumulated state with a keyframe's contents. */
  loadFrom(state: KeyframeState): void {
    this.clear();
    for (const v of state.vehicles ?? []) {
      if (v && typeof v.id === "string") this.vehicles.set(v.id, v);
    }
    for (const d of state.directions ?? []) {
      const id = d?.vehicleId;
      if (typeof id === "string") this.directions.set(id, d);
    }
    for (const inc of state.incidents ?? []) {
      const id = inc?.id;
      if (typeof id === "string") this.incidents.set(id, inc);
    }
    this.heatzones = state.heatzones ?? null;
  }

  /** Records a vehicle's latest snapshot (used by the writer, which sees the
   * full per-tick fleet even when dedup keeps it out of the file). */
  trackVehicle(snapshot: VehicleSnapshot): void {
    this.vehicles.set(snapshot.id, snapshot);
  }

  /**
   * Folds one recorded event into the state. `type` is a `RecordingEventType`
   * (typed loosely so replay can pass a raw parsed value).
   */
  apply(type: string, data: Record<string, unknown>): void {
    if (!data) return;
    switch (type) {
      case "vehicle": {
        const list = (data as { vehicles?: VehicleSnapshot[] }).vehicles;
        if (Array.isArray(list)) {
          for (const v of list) {
            if (v && typeof v.id === "string") this.vehicles.set(v.id, v);
          }
        }
        break;
      }
      case "direction": {
        const id = data.vehicleId;
        if (typeof id === "string") this.directions.set(id, data);
        break;
      }
      case "route:completed": {
        // Mirrors the UI, which drops a vehicle's drawn route when its route
        // completes; keeping it would resurrect a stale polyline after a seek.
        const id = data.vehicleId;
        if (typeof id === "string") this.directions.delete(id);
        break;
      }
      case "incident": {
        const id = data.id;
        if (typeof id !== "string") break;
        if (data.action === "created") this.incidents.set(id, data);
        else if (data.action === "cleared") this.incidents.delete(id);
        break;
      }
      case "heatzone":
        this.heatzones = data;
        break;
      case "despawn": {
        const id = typeof data.vehicleId === "string" ? data.vehicleId : data.id;
        if (typeof id === "string") {
          this.vehicles.delete(id);
          this.directions.delete(id);
        }
        break;
      }
      case "simulation:reset":
        this.clear();
        break;
      default:
        // spawn / waypoint / vehicle:rerouted / simulation:start / stop are
        // transient or already reflected by the events above.
        break;
    }
  }

  /** True when nothing has been accumulated (nothing to restore on seek). */
  isEmpty(): boolean {
    return (
      this.vehicles.size === 0 &&
      this.directions.size === 0 &&
      this.incidents.size === 0 &&
      this.heatzones === null
    );
  }

  /** Serializable snapshot of the accumulated state. */
  toKeyframeState(): KeyframeState {
    return {
      vehicles: Array.from(this.vehicles.values()),
      directions: Array.from(this.directions.values()),
      incidents: Array.from(this.incidents.values()),
      heatzones: this.heatzones,
    };
  }
}

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

  /** Running full-state fold, written out periodically as a keyframe line. */
  private keyframeState = new KeyframeStateAccumulator();
  /** Recording-time cadence between keyframe lines. */
  private readonly keyframeIntervalMs: number;
  /** Recording timestamp at/after which the next keyframe line is due. */
  private nextKeyframeTs = 0;
  /** Number of keyframe lines written in the current recording. */
  private keyframeCount = 0;

  /**
   * @param options.keyframeIntervalMs - Recording-time ms between full-state
   *   keyframe lines. Defaults to {@link KEYFRAME_INTERVAL_MS}. Pass `0` (or a
   *   negative value) to disable keyframes entirely and produce a file
   *   byte-identical in shape to pre-keyframe recordings.
   */
  constructor(options?: { keyframeIntervalMs?: number }) {
    super();
    this.keyframeIntervalMs = options?.keyframeIntervalMs ?? KEYFRAME_INTERVAL_MS;
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
    this.keyframeState.clear();
    this.keyframeCount = 0;
    // First keyframe is due one full interval in, not at t=0: a seek into the
    // opening interval only has to fold a handful of lines anyway, and holding
    // off keeps short recordings byte-identical to pre-keyframe output.
    this.nextKeyframeTs = this.keyframeIntervalMs;

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
      const snapshot: VehicleSnapshot = {
        id: v.id,
        position: [v.position[0], v.position[1]],
        speed: v.speed,
        heading: v.heading,
        edgeId: "", // VehicleDTO doesn't carry edgeId; caller can enrich if needed
        ...(v.fleetId ? { fleetId: v.fleetId } : {}),
      };

      // Track EVERY vehicle for keyframes, including ones dedup drops below.
      // Dedup is a file-size optimisation; a keyframe has to describe the whole
      // fleet or a seek past a stationary vehicle would lose it.
      this.keyframeState.trackVehicle(snapshot);

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

      changed.push(snapshot);

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

    // Fold into the running state BEFORE deciding on a keyframe, so a keyframe
    // written at this timestamp already includes this event. Replay therefore
    // rolls forward from the keyframe's event index (exclusive of everything
    // the keyframe already covers).
    this.keyframeState.apply(type, data);

    if (this.keyframeIntervalMs > 0 && timestamp >= this.nextKeyframeTs) {
      this.writeKeyframe(timestamp);
      // Anchor to the actual timestamp rather than accumulating the interval,
      // so a long gap between events does not emit a burst of catch-up frames.
      this.nextKeyframeTs = timestamp + this.keyframeIntervalMs;
    }

    if (this.buffer.length >= BUFFER_FLUSH_COUNT) {
      this.flushBuffer();
    }
  }

  /** Number of keyframe lines written in the current (or last) recording. */
  getKeyframeCount(): number {
    return this.keyframeCount;
  }

  /**
   * Appends a full-state keyframe line. Keyframes do NOT count toward
   * `eventCount`: they are derived data, not captured events, and the metadata
   * an operator sees should keep describing the simulation.
   */
  private writeKeyframe(timestamp: number): void {
    const keyframe: RecordingKeyframe = {
      timestamp,
      type: "keyframe",
      state: this.keyframeState.toKeyframeState(),
    };
    this.buffer.push(JSON.stringify(keyframe));
    this.keyframeCount++;
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
