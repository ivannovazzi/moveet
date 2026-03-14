import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
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

  private stream: fs.WriteStream | null = null;
  private buffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  /** Last known position per vehicle id, used for delta dedup. */
  private lastPositions: Map<string, [number, number]> = new Map();

  constructor() {
    super();
  }

  /**
   * Begins capturing events to an NDJSON file.
   *
   * @param options - Current simulation start options (written into the header)
   * @param vehicleCount - Number of vehicles at recording start
   * @param filePath - Optional explicit file path; auto-generated if omitted
   */
  startRecording(
    options: StartOptions,
    vehicleCount: number,
    filePath?: string
  ): string {
    if (this.recording) {
      throw new Error("Recording already in progress");
    }

    this.startTime = Date.now();
    this.startTimeISO = new Date(this.startTime).toISOString();
    this.vehicleCount = vehicleCount;
    this.eventCount = 0;
    this.lastPositions.clear();
    this.buffer = [];

    // Determine file path
    if (filePath) {
      this.filePath = filePath;
    } else {
      const safeDate = this.startTimeISO.replace(/:/g, "-");
      const fileName = `moveet-${safeDate}-${vehicleCount}v.ndjson`;
      this.filePath = path.join("recordings", fileName);
    }

    // Ensure directory exists
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    // Open write stream
    this.stream = fs.createWriteStream(this.filePath, { flags: "w" });
    this.stream.on("error", (err) => {
      this.emit("recording:error", err);
    });

    // Write header as first line
    const header: RecordingHeader = {
      format: "moveet-recording",
      version: 1,
      startTime: this.startTimeISO,
      vehicleCount,
      options,
    };
    this.stream.write(JSON.stringify(header) + "\n");

    // Start periodic flush timer
    this.flushTimer = setInterval(() => this.flushBuffer(), BUFFER_FLUSH_INTERVAL_MS);

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

    // Close stream
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }

    this.recording = false;

    const duration = Date.now() - this.startTime;
    let fileSize = 0;
    try {
      fileSize = fs.statSync(this.filePath).size;
    } catch {
      // File may not be fully flushed yet; ignore
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
      const prev = this.lastPositions.get(v.id);
      if (prev) {
        const dlat = Math.abs(v.position[0] - prev[0]);
        const dlng = Math.abs(v.position[1] - prev[1]);
        if (dlat < POSITION_DELTA_THRESHOLD && dlng < POSITION_DELTA_THRESHOLD) {
          continue;
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

    const event: RecordingEvent = {
      timestamp: Date.now() - this.startTime,
      type,
      data,
    };

    this.buffer.push(JSON.stringify(event));
    this.eventCount++;

    if (this.buffer.length >= BUFFER_FLUSH_COUNT) {
      this.flushBuffer();
    }
  }

  /**
   * Writes all buffered event lines to the stream.
   */
  private flushBuffer(): void {
    if (this.buffer.length === 0 || !this.stream) return;

    const chunk = this.buffer.join("\n") + "\n";
    this.buffer = [];
    this.stream.write(chunk);
  }
}
