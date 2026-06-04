import { RoadNetwork } from "../modules/RoadNetwork";
import { VehicleManager } from "../modules/VehicleManager";
import { FleetManager } from "../modules/FleetManager";
import { IncidentManager } from "../modules/IncidentManager";
import { RecordingManager } from "../modules/RecordingManager";
import { config } from "../utils/config";
import { createLogger } from "../utils/logger";
import type { RecordingMetadata, VehicleSnapshot } from "../types";

const log = createLogger("headless");

/** Number of sim steps processed between event-loop yields. */
const DEFAULT_CHUNK_STEPS = 200;

export interface HeadlessRunnerOptions {
  /** Path to the GeoJSON road network. */
  geojsonPath: string;
  /** Number of synthetic vehicles to seed. */
  vehicles: number;
  /** Absolute, historical start of the simulated window. */
  simStart: Date;
  /** Simulated milliseconds advanced per step. */
  stepMs: number;
  /** Total simulated milliseconds to generate (steps = totalSimMs / stepMs). */
  totalSimMs: number;
  /** Output NDJSON path (inside the recordings/ dir). */
  out: string;
  /** Sim RNG seed (best-effort determinism — see {@link installSeededRandom}). */
  seed: number;
  /** Steps to process between event-loop yields (keeps the server responsive). */
  chunkSteps?: number;
  /**
   * Load vehicles from the configured external source (adapter) instead of
   * seeding synthetic ones — so generated vehicles carry their real ids and GPS
   * device metadata (`metadata.devices`). Defaults to true when `config.adapterURL`
   * is set (i.e. the simulator is wired to a source), false otherwise.
   */
  useSource?: boolean;
}

/** Progress callback fired roughly once per processed chunk. */
export type HeadlessProgress = (step: number, totalSteps: number) => void;

/**
 * Builds a seeded mulberry32 PRNG.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Headless fast-forward generator.
 *
 * Builds the real module graph the way `src/index.ts` does (RoadNetwork +
 * VehicleManager + sim clock), seeds N synthetic vehicles via the existing
 * synthetic-vehicle path (the VehicleManager constructor's `loadFromData` +
 * `setRandomDestination`, exercised by forcing the relevant config), sets the
 * clock to an absolute historical `simStart`, then advances the sim a fixed
 * `stepMs` at a time — with NO `setInterval` and NO `Date.now()`.
 *
 * Output reuses the EXISTING RecordingManager NDJSON format (header +
 * relative-offset `vehicle` events) in RAW mode: timestamps are
 * sim-clock-relative, there is no position dedup, and the header is back-dated
 * to `simStart`. The generated file is therefore a first-class entry in the
 * existing `/recordings` list and replays in the map for free.
 */
export class HeadlessRunner {
  /**
   * IncidentManager wired to the sim clock so any incident timestamps back-date
   * consistently in the headless path (no `Date.now()` leak). Exposed for
   * callers that want to seed incidents before/while running.
   */
  public incidentManager?: IncidentManager;

  constructor(private readonly opts: HeadlessRunnerOptions) {}

  /** Total number of steps this run will produce. */
  get totalSteps(): number {
    return Math.floor(this.opts.totalSimMs / this.opts.stepMs);
  }

  /**
   * Runs the fast-forward generation, writing a back-dated NDJSON recording via
   * RecordingManager raw mode. Yields to the event loop between chunks so a
   * long generation does not block the server. Resolves with the resulting
   * {@link RecordingMetadata} (ready to insert into stateStore exactly like a
   * normal recording).
   *
   * @param onProgress - Optional progress callback (step, totalSteps).
   */
  async run(onProgress?: HeadlessProgress): Promise<RecordingMetadata> {
    const { geojsonPath, vehicles, simStart, stepMs, totalSimMs, out, seed } = this.opts;

    if (stepMs <= 0) throw new Error("stepMs must be > 0");
    if (totalSimMs <= 0) throw new Error("totalSimMs must be > 0");

    const steps = this.totalSteps;
    const chunkSteps = this.opts.chunkSteps ?? DEFAULT_CHUNK_STEPS;

    // Best-effort deterministic seeding: the sim's RNG is `Math.random`. We swap
    // it for a seeded mulberry32 for the duration of the run so a given seed
    // yields the same vehicle placement and routing.
    const restoreRandom = installSeededRandom(seed);

    // Vehicle origin: mirror the simulator's configured source. When an adapter
    // URL is set we load the real fleet (real ids + GPS metadata.devices) the
    // way the live sim does; otherwise we seed synthetic vehicles (empty
    // adapterURL makes the VehicleManager constructor call loadFromData(), and
    // vehicleCount controls how many). We snapshot/restore the live config.
    const useSource = this.opts.useSource ?? !!config.adapterURL;
    const prevVehicleCount = config.vehicleCount;
    const prevAdapterURL = config.adapterURL;
    const prevGeojsonPath = config.geojsonPath;
    (config as { geojsonPath: string }).geojsonPath = geojsonPath;
    if (!useSource) {
      (config as { vehicleCount: number }).vehicleCount = vehicles;
      (config as { adapterURL: string }).adapterURL = "";
    }

    const recordingManager = new RecordingManager();

    try {
      const roadNetwork = new RoadNetwork(geojsonPath);
      const fleetManager = new FleetManager();
      // With a source configured the constructor does NOT auto-seed; synthetic
      // vehicles are seeded in the constructor when adapterURL is empty.
      const vehicleManager = new VehicleManager(roadNetwork, fleetManager);
      // IncidentManager shares the sim clock so any incident timestamps back-date
      // consistently (no Date.now() leak in the headless path).
      this.incidentManager = new IncidentManager(vehicleManager.clock);

      const clock = vehicleManager.clock;
      clock.setTime(simStart);

      // Load the real fleet from the configured source (ids + metadata.devices),
      // assigning each a route so it moves — same path as the live sim. The
      // requested `vehicles` count caps the fleet subset (0 = whole fleet).
      if (useSource) {
        await vehicleManager.initFromAdapter(vehicles > 0 ? vehicles : undefined);
      }

      const actualVehicleCount = vehicleManager.getVehicles().length;
      // Real GPS device mapping (vehicleId → { devices: [...] }), recorded once
      // in the header so replay/emit fans out to the real device ids.
      const vehicleMeta = vehicleManager.getVehicleMetadata();

      recordingManager.startRecording(vehicleManager.getOptions(), actualVehicleCount, out, {
        startTime: simStart,
        stepMs,
        seed,
        vehicleMeta,
        clock,
      });

      log.info(
        `Generating ${steps} steps (${totalSimMs}ms @ ${stepMs}ms) for ${actualVehicleCount} ` +
          `vehicles (${useSource ? "from source" : "synthetic"}, ${Object.keys(vehicleMeta).length} ` +
          `with device metadata) from ${simStart.toISOString()} → ${out}`
      );

      let i = 0;
      while (i < steps) {
        const end = Math.min(i + chunkSteps, steps);
        for (; i < end; i++) {
          vehicleManager.advance(stepMs);
          recordingManager.captureVehicleSnapshot(vehicleManager.getVehicles());
        }
        onProgress?.(i, steps);
        // Yield to the macrotask queue (not just microtasks) so pending I/O —
        // incoming HTTP requests, WS progress broadcasts — can run between
        // chunks and the server stays responsive during a long generation.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      const metadata = recordingManager.stopRecording();
      onProgress?.(steps, steps);
      log.info(`Done: wrote ${steps} steps (${metadata.eventCount} events) to ${out}`);
      return metadata;
    } finally {
      if (recordingManager.isRecording()) {
        try {
          recordingManager.stopRecording();
        } catch {
          // already stopped / never started
        }
      }
      (config as { vehicleCount: number }).vehicleCount = prevVehicleCount;
      (config as { adapterURL: string }).adapterURL = prevAdapterURL;
      (config as { geojsonPath: string }).geojsonPath = prevGeojsonPath;
      restoreRandom();
    }
  }
}

/** Re-exported for clarity; the snapshot shape written per `vehicle` event. */
export type { VehicleSnapshot };

/**
 * Overrides the global `Math.random` with a seeded mulberry32 PRNG and returns a
 * restore function. The simulator seeds vehicles and routes via `Math.random`,
 * so this makes a given `seed` reproducible on a best-effort basis.
 */
function installSeededRandom(seed: number): () => void {
  const original = Math.random;
  const rng = mulberry32(seed);
  Math.random = rng;
  return () => {
    Math.random = original;
  };
}
