import fs from "fs";
import path from "path";
import type { TruthHeader, TruthStepRecord, TruthVehicle, VehicleDTO } from "../types";

/** Maximum number of buffered step lines before a forced flush. */
const BUFFER_FLUSH_COUNT = 1000;

/**
 * Streams headless "truth" telemetry to an NDJSON file following the
 * `moveet-headless-truth` format contract (see {@link TruthHeader} /
 * {@link TruthStepRecord}).
 *
 * This is the raw-export counterpart to {@link RecordingManager}: it reuses the
 * same buffered synchronous-write pattern but differs in two deliberate ways
 * required by Phase 2:
 *
 * 1. `simTime` is stamped from an ABSOLUTE clock time passed per step, not from
 *    `Date.now() - startTime`.
 * 2. There is NO position dedup — every active vehicle is captured every step so
 *    cadence is retained for idle-but-running vehicles.
 *
 * No timers are used; the writer is driven synchronously by the headless loop.
 */
export class TruthWriter {
  private readonly fd: number;
  private buffer: string[] = [];
  private stepCount = 0;
  private closed = false;

  constructor(filePath: string, header: TruthHeader) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    this.fd = fs.openSync(filePath, "w");
    // Header is line 1.
    fs.writeSync(this.fd, JSON.stringify(header) + "\n");
  }

  /**
   * Appends one step record stamped with the given absolute sim time.
   *
   * @param simTime - Absolute simulated time for this step (from the sim clock).
   * @param vehicles - DTOs for every active vehicle this step (no dedup).
   */
  writeStep(simTime: Date, vehicles: VehicleDTO[]): void {
    if (this.closed) throw new Error("TruthWriter is closed");

    const record: TruthStepRecord = {
      simTime: simTime.toISOString(),
      vehicles: vehicles.map(toTruthVehicle),
    };

    this.buffer.push(JSON.stringify(record));
    this.stepCount++;

    if (this.buffer.length >= BUFFER_FLUSH_COUNT) {
      this.flush();
    }
  }

  /** Number of step records written so far. */
  getStepCount(): number {
    return this.stepCount;
  }

  /** Flushes remaining buffered lines and closes the file. */
  close(): void {
    if (this.closed) return;
    this.flush();
    fs.closeSync(this.fd);
    this.closed = true;
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    const chunk = this.buffer.join("\n") + "\n";
    this.buffer = [];
    fs.writeSync(this.fd, chunk);
  }
}

/**
 * Converts a {@link VehicleDTO} to a {@link TruthVehicle}. Ignition is true when
 * the vehicle is powered/running — in headless generation all synthetic vehicles
 * are active, so ignition is always true here.
 */
function toTruthVehicle(v: VehicleDTO): TruthVehicle {
  return {
    id: v.id,
    position: [v.position[0], v.position[1]],
    speed: v.speed,
    heading: v.heading,
    ignition: true,
  };
}
