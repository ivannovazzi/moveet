import type { VehicleUpdate } from "../types";
import type { PublishResult } from "../plugins/types";
import { RealismEngine } from "../realism/RealismEngine";
import { mulberry32 } from "../realism/rng";
import { createLogger } from "../utils/logger";

const logger = createLogger("ReplayEmitter");

/** Scheduler granularity for walking virtual time between events (ms). */
const REALISM_TICK_MS = 250;

/**
 * Header line of the simulator's RecordingManager NDJSON (line 1).
 * Only `startTime` is required for emit; the rest is metadata.
 */
export interface RecordingHeader {
  format?: string;
  version?: number;
  /** Absolute ISO of the (historical) recording start. */
  startTime: string;
  vehicleCount?: number;
  generated?: boolean;
  stepMs?: number;
  seed?: number;
  options?: Record<string, unknown>;
}

/** A vehicle as carried inside a `vehicle` recording event. */
export interface RecordingVehicle {
  id: string;
  /** `[lat, lon]` — matches VehicleDTO.position. */
  position: [number, number];
  /** Ground speed in km/h. */
  speed: number;
  heading: number;
  fleetId?: string;
}

/** One recording event line. Only `type === "vehicle"` is emitted. */
export interface RecordingEvent {
  /** Milliseconds offset from `header.startTime`. */
  timestamp: number;
  type: string;
  data?: { vehicles?: RecordingVehicle[] } & Record<string, unknown>;
}

export interface ReplayEmitterOptions {
  /**
   * Source of NDJSON lines: any async iterable that yields raw lines (e.g. the
   * line-split body of an HTTP response, or a file read stream). The recording
   * does NOT need to live on the adapter's local disk.
   */
  source: AsyncIterable<string>;
  /** Run the recording through the RealismEngine (true) or emit raw (false). */
  realism: boolean;
  /** Deterministic seed for the realism RNG (realism-on only). */
  seed?: number;
  /**
   * Realism config overrides. Merged over the header's `seed` so a fixed seed
   * is reproducible. Ignored when `realism` is false.
   */
  realismConfig?: Record<string, unknown>;
  /**
   * Publish fn — the real sink fan-out (PluginManager.publishToSinks) or a mock
   * in tests. Awaited per batch for backpressure.
   */
  publish: (updates: VehicleUpdate[]) => Promise<PublishResult>;
  /**
   * Optional progress callback, invoked after each emitted `vehicle` event with
   * the count of vehicle events processed so far. Used by the route job to feed
   * `GET /replay/emit/status`.
   */
  onProgress?: (processed: number) => void;
}

/**
 * Map a recording vehicle to the adapter's VehicleUpdate at virtual time `t`.
 *
 * - `position` is `[lat, lon]` → `latitude` / `longitude`.
 * - `speed` is km/h, carried through unchanged (the sinks convert to m/s).
 * - generated vehicles are always ignition/connected on while emitting.
 * - `timestamp` is the virtual (back-dated) time `t` — never `Date.now()`.
 */
function toVehicleUpdate(v: RecordingVehicle, t: number): VehicleUpdate {
  return {
    id: v.id,
    latitude: v.position[0],
    longitude: v.position[1],
    speed: v.speed,
    heading: v.heading,
    timestamp: t,
    connected: true,
  };
}

/**
 * Splits a chunked text source (e.g. an HTTP response body decoded to strings)
 * into individual lines. Accepts either an async iterable of string chunks (any
 * boundaries) or already line-delimited strings — both work.
 */
export async function* toLines(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let buf = "";
  for await (const chunk of chunks) {
    buf += chunk;
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      yield buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
    }
  }
  if (buf.length > 0) yield buf;
}

/**
 * Replays a simulator RecordingManager NDJSON stream through the existing sinks,
 * driven by a VIRTUAL clock so every emitted message's timestamp is the
 * (historical) simulation time — `header.startTime + event.timestamp` — never
 * wall-clock. A week of telemetry emits in minutes, bounded only by sink
 * throughput.
 */
export class ReplayEmitter {
  private readonly opts: ReplayEmitterOptions;
  /** Count of `vehicle` events emitted (for progress reporting). */
  private processed = 0;

  constructor(opts: ReplayEmitterOptions) {
    this.opts = opts;
  }

  get emitted(): number {
    return this.processed;
  }

  async run(): Promise<void> {
    const iterator = toLines(this.opts.source)[Symbol.asyncIterator]();

    // Line 1 is the header.
    let header: RecordingHeader | null = null;
    while (header === null) {
      const next = await iterator.next();
      if (next.done) throw new Error("Recording is empty (no header line)");
      const trimmed = next.value.trim();
      if (!trimmed) continue;
      const obj = JSON.parse(trimmed) as RecordingHeader;
      if (typeof obj.startTime !== "string") {
        throw new Error("Recording header missing startTime");
      }
      header = obj;
    }

    const startMs = Date.parse(header.startTime);
    if (Number.isNaN(startMs)) {
      throw new Error(`Invalid recording header.startTime: ${header.startTime}`);
    }

    if (this.opts.realism) {
      await this.runRealism(header, startMs, iterator);
    } else {
      await this.runRaw(startMs, iterator);
    }

    logger.info({ events: this.processed, realism: this.opts.realism }, "Replay complete");
  }

  /** Parse a line into a `vehicle` event, or null if it is empty / non-vehicle. */
  private parseVehicleEvent(line: string): RecordingEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const event = JSON.parse(trimmed) as RecordingEvent;
    if (event.type !== "vehicle") return null;
    if (!event.data || !Array.isArray(event.data.vehicles)) return null;
    return event;
  }

  /** Realism-off: emit each vehicle event straight through, stamped virtual. */
  private async runRaw(startMs: number, iterator: AsyncIterator<string>): Promise<void> {
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
      const event = this.parseVehicleEvent(next.value);
      if (!event) continue;
      const virtual = startMs + event.timestamp;
      const updates = event.data!.vehicles!.map((v) => toVehicleUpdate(v, virtual));
      await this.opts.publish(updates); // await per batch for backpressure
      this.processed++;
      this.opts.onProgress?.(this.processed);
    }
  }

  /** Realism-on: drive the RealismEngine with a virtual clock and manual ticks. */
  private async runRealism(
    header: RecordingHeader,
    startMs: number,
    iterator: AsyncIterator<string>
  ): Promise<void> {
    let virtual = startMs;
    const seed = this.opts.seed ?? header.seed ?? 0;

    const engine = new RealismEngine({
      now: () => virtual, // sim time, never Date.now()
      rng: mulberry32(seed), // deterministic
      autoStart: false, // drive tick() manually; no setInterval
      publish: this.opts.publish,
      config: { seed, ...this.opts.realismConfig },
    });

    let seenAny = false;
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
      const event = this.parseVehicleEvent(next.value);
      if (!event) continue;
      const target = startMs + event.timestamp;
      // Walk virtual time toward the event's virtual time in tick-sized steps,
      // emitting any devices whose nextEmitAt falls due along the way.
      while (virtual < target) {
        virtual = Math.min(virtual + REALISM_TICK_MS, target);
        await engine.tick();
      }
      virtual = target;
      await engine.ingest(event.data!.vehicles!.map((v) => toVehicleUpdate(v, virtual)));
      seenAny = true;
      this.processed++;
      this.opts.onProgress?.(this.processed);
    }

    if (seenAny) {
      // Final drain: one more tick so the last ingested positions get emitted.
      await engine.tick();
    }
    engine.stop();
  }
}
