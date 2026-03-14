import * as fs from "fs";
import * as readline from "readline";
import { EventEmitter } from "events";
import type {
  RecordingHeader,
  RecordingEvent,
  ReplayStatus,
} from "../types";

type ReplayState = "idle" | "playing" | "paused";

type ReplayEventMap = {
  vehicle: [unknown];
  direction: [unknown];
  "incident:created": [unknown];
  "incident:cleared": [unknown];
  heatzones: [unknown];
  "waypoint:reached": [unknown];
  "route:completed": [unknown];
  "vehicle:rerouted": [unknown];
  "simulation:start": [unknown];
  "simulation:stop": [unknown];
  "simulation:reset": [unknown];
  replayStatus: [ReplayStatus];
  replayEnd: [];
};

export class ReplayManager extends EventEmitter<ReplayEventMap> {
  private events: RecordingEvent[] = [];
  private header: RecordingHeader | null = null;
  private filePath: string | null = null;

  private state: ReplayState = "idle";
  private speed: number = 1.0;
  private currentIndex: number = 0;
  private playbackTimer: NodeJS.Timeout | null = null;

  /** Wall-clock time when playback started (or resumed) */
  private playbackStartWall: number = 0;
  /** Recording timestamp corresponding to playbackStartWall */
  private playbackStartRecTs: number = 0;

  constructor() {
    super();
  }

  /**
   * Loads and validates an NDJSON recording file. Reads the header (first line)
   * and pre-loads all events into memory.
   *
   * @param filePath - Path to the NDJSON recording file
   * @returns The recording header metadata
   */
  async loadRecording(filePath: string): Promise<RecordingHeader> {
    this.cleanup();

    this.filePath = filePath;
    this.events = [];
    this.header = null;

    const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let isFirstLine = true;

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const parsed = JSON.parse(trimmed);

      if (isFirstLine) {
        isFirstLine = false;
        if (parsed.format !== "moveet-recording" || parsed.version !== 1) {
          throw new Error(
            `Invalid recording format: expected moveet-recording v1, got ${parsed.format} v${parsed.version}`
          );
        }
        this.header = parsed as RecordingHeader;
        continue;
      }

      this.events.push(parsed as RecordingEvent);
    }

    if (!this.header) {
      throw new Error("Recording file is empty or missing header");
    }

    this.state = "idle";
    this.currentIndex = 0;
    this.emitStatus();

    return this.header;
  }

  /**
   * Begins replaying events at the recorded timestamps, adjusted by the
   * speed multiplier.
   *
   * @param speed - Playback speed multiplier (default: 1.0)
   */
  startReplay(speed?: number): void {
    if (!this.header || this.events.length === 0) {
      throw new Error("No recording loaded");
    }

    this.speed = speed ?? 1.0;
    this.state = "playing";
    this.currentIndex = 0;

    this.playbackStartRecTs = this.events[0].timestamp;
    this.playbackStartWall = Date.now();

    this.scheduleNextEvent();
    this.emitStatus();
  }

  /**
   * Pauses playback, saving the current position.
   */
  pauseReplay(): void {
    if (this.state !== "playing") return;

    this.state = "paused";
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }
    this.emitStatus();
  }

  /**
   * Resumes playback from the paused position.
   */
  resumeReplay(): void {
    if (this.state !== "paused") return;

    this.state = "playing";

    // Re-anchor wall clock to current position
    if (this.currentIndex < this.events.length) {
      this.playbackStartRecTs = this.events[this.currentIndex].timestamp;
      this.playbackStartWall = Date.now();
    }

    this.scheduleNextEvent();
    this.emitStatus();
  }

  /**
   * Stops playback completely and resets state.
   */
  stopReplay(): void {
    this.cleanup();
    this.state = "idle";
    this.currentIndex = 0;
    this.emitStatus();
  }

  /**
   * Seeks to a specific timestamp (ms offset from recording start).
   * Uses binary search on the pre-loaded events array.
   *
   * @param timestamp - Target timestamp in ms offset from the start of the recording
   */
  seekTo(timestamp: number): void {
    if (!this.header || this.events.length === 0) {
      throw new Error("No recording loaded");
    }

    const wasPlaying = this.state === "playing";

    // Cancel any pending scheduled event
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }

    // The absolute target timestamp in recording time
    const recordingStartTs = this.events[0].timestamp;
    const targetTs = recordingStartTs + timestamp;

    // Binary search: find first event at or after targetTs
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.events[mid].timestamp < targetTs) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    this.currentIndex = lo;

    if (wasPlaying || this.state === "playing") {
      this.state = "playing";
      if (this.currentIndex < this.events.length) {
        this.playbackStartRecTs = this.events[this.currentIndex].timestamp;
        this.playbackStartWall = Date.now();
        this.scheduleNextEvent();
      } else {
        this.state = "idle";
        this.emit("replayEnd");
      }
    }

    this.emitStatus();
  }

  /**
   * Returns the current replay status.
   */
  getStatus(): ReplayStatus {
    if (!this.header || this.events.length === 0) {
      return { mode: "live" };
    }

    const firstTs = this.events[0].timestamp;
    const lastTs = this.events[this.events.length - 1].timestamp;
    const duration = lastTs - firstTs;

    const currentTs =
      this.currentIndex < this.events.length
        ? this.events[this.currentIndex].timestamp
        : lastTs;

    const currentTime = currentTs - firstTs;
    const progress = duration > 0 ? currentTime / duration : 1;

    return {
      mode: "replay",
      file: this.filePath ?? undefined,
      progress,
      duration,
      currentTime,
      speed: this.speed,
      paused: this.state === "paused",
    };
  }

  /**
   * Schedules the next event for emission using setTimeout.
   * Chains through all events sequentially.
   */
  private scheduleNextEvent(): void {
    if (this.state !== "playing") return;
    if (this.currentIndex >= this.events.length) {
      this.state = "idle";
      this.emitStatus();
      this.emit("replayEnd");
      return;
    }

    const event = this.events[this.currentIndex];
    const delayMs =
      (event.timestamp - this.playbackStartRecTs) / this.speed -
      (Date.now() - this.playbackStartWall);

    const actualDelay = Math.max(0, delayMs);

    this.playbackTimer = setTimeout(() => {
      if (this.state !== "playing") return;

      this.emitRecordingEvent(event);
      this.currentIndex++;
      this.scheduleNextEvent();
    }, actualDelay);
  }

  /**
   * Emits a recording event using the appropriate event name.
   */
  private emitRecordingEvent(event: RecordingEvent): void {
    switch (event.type) {
      case "vehicle":
        this.emit("vehicle", event.data);
        break;
      case "direction":
        this.emit("direction", event.data);
        break;
      case "incident":
        // Incident events contain an "action" field to distinguish created/cleared
        if (event.data.action === "created") {
          this.emit("incident:created", event.data);
        } else if (event.data.action === "cleared") {
          this.emit("incident:cleared", event.data);
        }
        break;
      case "heatzone":
        this.emit("heatzones", event.data);
        break;
      case "waypoint":
        this.emit("waypoint:reached", event.data);
        break;
      case "route:completed":
        this.emit("route:completed", event.data);
        break;
      case "vehicle:rerouted":
        this.emit("vehicle:rerouted", event.data);
        break;
      case "simulation:start":
        this.emit("simulation:start", event.data);
        break;
      case "simulation:stop":
        this.emit("simulation:stop", event.data);
        break;
      case "simulation:reset":
        this.emit("simulation:reset", event.data);
        break;
      // spawn and despawn are informational; no dedicated WS event
      default:
        break;
    }
  }

  /**
   * Emits the current replay status.
   */
  private emitStatus(): void {
    this.emit("replayStatus", this.getStatus());
  }

  /**
   * Cleans up timers and resets playback state.
   */
  private cleanup(): void {
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }
  }
}
