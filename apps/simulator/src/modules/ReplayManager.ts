import * as fs from "fs";
import * as readline from "readline";
import { EventEmitter } from "events";
import type { RecordingHeader, RecordingEvent, ReplayStatus } from "../types";
import {
  KeyframeStateAccumulator,
  type KeyframeState,
  type RecordingKeyframe,
} from "./RecordingManager";

type ReplayState = "idle" | "playing" | "paused";

/** A keyframe as indexed at load time. */
interface LoadedKeyframe {
  /** Recording timestamp the keyframe was written at. */
  timestamp: number;
  /**
   * Index into `events` of the first event NOT yet folded into `state`.
   * Keyframes are written immediately after the event they include, so this is
   * `events.length` at the moment the line was read.
   */
  eventIndex: number;
  state: KeyframeState;
}

/**
 * Diagnostics for the most recent {@link ReplayManager.seekTo} call.
 *
 * Exposed so the work a seek performs can be asserted directly (rather than
 * timing it, which is flaky). `eventsRolledForward` is the whole cost that
 * scales with anything: with keyframes it is bounded by the number of events
 * inside one keyframe interval, independent of how long the recording is.
 */
export interface SeekStats {
  /** Events folded to reconstruct state at the seek target. */
  eventsRolledForward: number;
  /** Whether a keyframe was found and used as the starting point. */
  usedKeyframe: boolean;
  /** Index of the keyframe used, or -1 when replaying the fold from the start. */
  keyframeIndex: number;
  /** Index in `events` the fold started from (0 without a keyframe). */
  startIndex: number;
  /** Index in `events` the fold stopped at (the new playback position). */
  targetIndex: number;
}

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
  "replay:status": [ReplayStatus];
  replayEnd: [];
};

export class ReplayManager extends EventEmitter<ReplayEventMap> {
  private events: RecordingEvent[] = [];
  private header: RecordingHeader | null = null;
  private filePath: string | null = null;

  /**
   * Full-state keyframes indexed by their position in `events`, in file order
   * (therefore sorted by both `timestamp` and `eventIndex`). Empty for
   * recordings made before keyframes existed — seek then folds from index 0.
   */
  private keyframes: LoadedKeyframe[] = [];

  private lastSeekStats: SeekStats = {
    eventsRolledForward: 0,
    usedKeyframe: false,
    keyframeIndex: -1,
    startIndex: 0,
    targetIndex: 0,
  };

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
    this.keyframes = [];
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

      // Keyframe lines are an index, not playback content: they never reach
      // `events` and are never emitted during normal forward playback (which
      // must stay byte-identical to pre-keyframe behaviour). Recordings written
      // before this feature simply contain none.
      if (parsed?.type === "keyframe") {
        const kf = parsed as RecordingKeyframe;
        this.keyframes.push({
          timestamp: kf.timestamp,
          eventIndex: this.events.length,
          state: kf.state,
        });
        continue;
      }

      this.events.push(parsed as RecordingEvent);
    }

    if (!this.header) {
      throw new Error("Recording file is empty or missing header");
    }

    if (this.events.length === 0) {
      throw new Error("Recording contains no events");
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
   * Changes playback speed without restarting. Re-anchors timing
   * so remaining events play at the new rate from the current position.
   */
  setSpeed(speed: number): void {
    this.speed = speed;

    if (this.state === "playing" && this.currentIndex < this.events.length) {
      // Re-anchor: treat "now" as the start for the current event
      if (this.playbackTimer) {
        clearTimeout(this.playbackTimer);
        this.playbackTimer = null;
      }
      this.playbackStartRecTs = this.events[this.currentIndex].timestamp;
      this.playbackStartWall = Date.now();
      this.scheduleNextEvent();
    }

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
    this.events = [];
    this.keyframes = [];
    this.header = null;
    this.filePath = null;
    this.emitStatus();
  }

  /**
   * Seeks to a specific timestamp (ms offset from recording start).
   *
   * Restores the full render state at the target before resuming: it jumps to
   * the nearest preceding full-state keyframe and rolls forward only the events
   * between that keyframe and the target, then emits the reconstructed state on
   * the ordinary replay channels. The rolled-forward span is bounded by the
   * keyframe cadence, so the cost does not grow with the length of the
   * recording.
   *
   * Recordings with no keyframes (anything written before keyframes existed)
   * fall back to folding from the first event — the previous behaviour, and
   * still correct, just O(session length).
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
    this.restoreStateAt(lo);

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
   * Diagnostics for the most recent {@link seekTo} call.
   */
  getSeekStats(): SeekStats {
    return { ...this.lastSeekStats };
  }

  /** Number of full-state keyframes found in the loaded recording. */
  getKeyframeCount(): number {
    return this.keyframes.length;
  }

  /**
   * Reconstructs the render state as of `targetIndex` (exclusive) and emits it
   * on the ordinary replay channels.
   *
   * Starts from the newest keyframe whose covered span ends at or before
   * `targetIndex`, then folds the remaining events. Without keyframes it folds
   * from zero, which is exactly what a replay-from-start would converge to.
   */
  private restoreStateAt(targetIndex: number): void {
    const accumulator = new KeyframeStateAccumulator();

    // Binary search for the last keyframe with eventIndex <= targetIndex.
    // Comparing indices (not timestamps) is what keeps this exact when several
    // events share a timestamp.
    let keyframeIndex = -1;
    let lo = 0;
    let hi = this.keyframes.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.keyframes[mid].eventIndex <= targetIndex) {
        keyframeIndex = mid;
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    let startIndex = 0;
    if (keyframeIndex >= 0) {
      accumulator.loadFrom(this.keyframes[keyframeIndex].state);
      startIndex = this.keyframes[keyframeIndex].eventIndex;
    }

    let rolledForward = 0;
    for (let i = startIndex; i < targetIndex; i++) {
      const event = this.events[i];
      accumulator.apply(event.type, event.data);
      rolledForward++;
    }

    this.lastSeekStats = {
      eventsRolledForward: rolledForward,
      usedKeyframe: keyframeIndex >= 0,
      keyframeIndex,
      startIndex,
      targetIndex,
    };

    if (accumulator.isEmpty()) return;

    // Emit on the SAME channels with the SAME payload shapes normal playback
    // uses — a client cannot tell a restored state apart from having received
    // every earlier event.
    const state = accumulator.toKeyframeState();

    if (state.heatzones) {
      this.emit("heatzones", state.heatzones);
    }
    for (const incident of state.incidents) {
      this.emit("incident:created", incident);
    }
    if (state.vehicles.length > 0) {
      this.emit("vehicle", { vehicles: state.vehicles });
    }
    for (const direction of state.directions) {
      this.emit("direction", direction);
    }
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
      this.currentIndex < this.events.length ? this.events[this.currentIndex].timestamp : lastTs;

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
    this.emit("replay:status", this.getStatus());
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
