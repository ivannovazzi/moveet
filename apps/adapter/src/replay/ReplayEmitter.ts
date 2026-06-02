import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { VehicleUpdate } from "../types";
import type { PublishResult } from "../plugins/types";
import { RealismEngine } from "../realism/RealismEngine";
import { mulberry32 } from "../realism/rng";
import { createLogger } from "../utils/logger";

const logger = createLogger("ReplayEmitter");

/** Scheduler granularity for walking virtual time between records (ms). */
const REALISM_TICK_MS = 250;

/** Header line of the NDJSON truth file (Phase-1 contract). */
export interface TruthHeader {
  format: string;
  version: number;
  simStart: string;
  stepMs: number;
  vehicleCount: number;
  seed: number;
  network: string;
}

/** A single truth vehicle row as written by Phase 1. */
export interface TruthVehicle {
  id: string;
  /** `[lat, lon]` — matches VehicleDTO.position. */
  position: [number, number];
  /** Ground speed in km/h. */
  speed: number;
  heading: number;
  ignition: boolean;
}

/** One step record: an absolute sim time + every active vehicle's true state. */
export interface TruthRecord {
  simTime: string;
  vehicles: TruthVehicle[];
}

export interface ReplayEmitterOptions {
  /** Path to the Phase-1 NDJSON truth file. */
  ndjsonPath: string;
  /** Run truth through the RealismEngine (true) or emit raw (false). */
  realism: boolean;
  /** Deterministic seed for the realism RNG (realism-on only). */
  seed?: number;
  /**
   * Realism config overrides. Merged over the file's `seed` so a fixed seed is
   * reproducible. Ignored when `realism` is false.
   */
  realismConfig?: Record<string, unknown>;
  /**
   * Publish fn — the real sink fan-out (PluginManager) or a mock in tests.
   * Awaited per batch for backpressure.
   */
  publish: (updates: VehicleUpdate[]) => Promise<PublishResult>;
}

/**
 * Map a Phase-1 truth vehicle to the adapter's VehicleUpdate at sim time `t`.
 *
 * - `position` is `[lat, lon]` → `latitude` / `longitude`.
 * - `speed` is km/h, carried through unchanged (the sinks convert to m/s).
 * - `ignition` maps to `connected` (ignition off ⇒ device offline).
 * - `timestamp` is the sim time `t` — never `Date.now()`.
 */
function toVehicleUpdate(v: TruthVehicle, t: number): VehicleUpdate {
  return {
    id: v.id,
    latitude: v.position[0],
    longitude: v.position[1],
    speed: v.speed,
    heading: v.heading,
    timestamp: t,
    connected: v.ignition,
  };
}

/**
 * Replays a Phase-1 NDJSON "truth" file through the existing sinks, driven by a
 * VIRTUAL clock so every emitted message's timestamp is the SIMULATION time
 * from the file — never wall-clock. A week of telemetry emits in minutes,
 * bounded only by sink (Kafka) throughput.
 */
export class ReplayEmitter {
  private readonly opts: ReplayEmitterOptions;

  constructor(opts: ReplayEmitterOptions) {
    this.opts = opts;
  }

  /** Read + parse the NDJSON file into a header and ordered records. */
  private async read(): Promise<{ header: TruthHeader; records: TruthRecord[] }> {
    const rl = createInterface({
      input: createReadStream(this.opts.ndjsonPath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    let header: TruthHeader | null = null;
    const records: TruthRecord[] = [];
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const obj = JSON.parse(trimmed);
      if (!header) {
        if (obj.format !== "moveet-headless-truth") {
          throw new Error(`Unexpected NDJSON header format: ${String(obj.format)}`);
        }
        header = obj as TruthHeader;
        continue;
      }
      records.push(obj as TruthRecord);
    }
    if (!header) throw new Error("NDJSON file is empty (no header line)");
    return { header, records };
  }

  async run(): Promise<void> {
    const { header, records } = await this.read();
    if (records.length === 0) {
      logger.warn("No step records to emit");
      return;
    }
    if (this.opts.realism) {
      await this.runRealism(header, records);
    } else {
      await this.runRaw(records);
    }
    logger.info({ records: records.length, realism: this.opts.realism }, "Replay complete");
  }

  /** Realism-off: emit each record's vehicles straight through, stamped with sim time. */
  private async runRaw(records: TruthRecord[]): Promise<void> {
    for (const record of records) {
      const t = Date.parse(record.simTime);
      const updates = record.vehicles.map((v) => toVehicleUpdate(v, t));
      await this.opts.publish(updates); // await per batch for backpressure
    }
  }

  /** Realism-on: drive the RealismEngine with a virtual clock and manual ticks. */
  private async runRealism(header: TruthHeader, records: TruthRecord[]): Promise<void> {
    let virtual = Date.parse(records[0].simTime);
    const seed = this.opts.seed ?? header.seed;

    const engine = new RealismEngine({
      now: () => virtual, // sim time, never Date.now()
      rng: mulberry32(seed), // deterministic
      autoStart: false, // drive tick() manually; no setInterval
      publish: this.opts.publish,
      config: { seed, ...this.opts.realismConfig },
    });

    for (const record of records) {
      const target = Date.parse(record.simTime);
      // Walk virtual time toward the record's sim time in tick-sized steps,
      // emitting any devices whose nextEmitAt falls due along the way.
      while (virtual < target) {
        virtual = Math.min(virtual + REALISM_TICK_MS, target);
        await engine.tick();
      }
      virtual = target;
      await engine.ingest(record.vehicles.map((v) => toVehicleUpdate(v, virtual)));
    }
    // Final drain: one more tick so the last ingested positions get emitted.
    await engine.tick();
    engine.stop();
  }
}
