import { RoadNetwork } from "../modules/RoadNetwork";
import { VehicleManager } from "../modules/VehicleManager";
import { FleetManager } from "../modules/FleetManager";
import { IncidentManager } from "../modules/IncidentManager";
import { config } from "../utils/config";
import { createLogger } from "../utils/logger";
import { TruthWriter } from "./TruthWriter";
import type { TruthHeader } from "../types";

const log = createLogger("headless");

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
  /** Output NDJSON path. */
  out: string;
  /** Sim RNG seed (best-effort determinism — see {@link installSeededRandom}). */
  seed: number;
  /** Network identifier written into the header (e.g. "nairobi"). */
  network: string;
}

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
 * Headless fast-forward generator (Phase 1).
 *
 * Builds the real module graph the way `src/index.ts` does (RoadNetwork +
 * VehicleManager + sim clock), seeds N synthetic vehicles via the existing
 * synthetic-vehicle path (the VehicleManager constructor's `loadFromData` +
 * `setRandomDestination`, exercised by temporarily forcing the relevant config),
 * sets the clock to an absolute historical `simStart`, then advances the sim a
 * fixed `stepMs` at a time — with NO `setInterval` and NO `Date.now()` — writing
 * back-dated NDJSON "truth" per the format contract.
 */
export class HeadlessRunner {
  /**
   * IncidentManager wired to the sim clock so any incident timestamps back-date
   * consistently in the headless path (no `Date.now()` leak). Exposed for
   * callers that want to seed incidents before/while running.
   */
  public incidentManager?: IncidentManager;

  constructor(private readonly opts: HeadlessRunnerOptions) {}

  run(): void {
    const { geojsonPath, vehicles, simStart, stepMs, totalSimMs, out, seed, network } = this.opts;

    if (stepMs <= 0) throw new Error("stepMs must be > 0");
    if (totalSimMs <= 0) throw new Error("totalSimMs must be > 0");

    const steps = Math.floor(totalSimMs / stepMs);

    // Best-effort deterministic seeding: the sim's RNG is `Math.random` (in
    // RoadNetwork.getRandomEdge / RouteManager.setRandomDestination, etc.). We
    // swap it for a seeded mulberry32 for the duration of the run so a given
    // --seed yields the same vehicle placement and routing. This is NOT a full
    // RNG refactor; any non-Math.random source (e.g. crypto) is unaffected.
    const restoreRandom = installSeededRandom(seed);

    // Force the synthetic-vehicle creation path: an empty adapterURL makes the
    // VehicleManager constructor call loadFromData() (seeding vehicles +
    // assigning random destinations via setRandomDestination), and vehicleCount
    // controls how many. We snapshot and restore the live config afterward.
    const prevVehicleCount = config.vehicleCount;
    const prevAdapterURL = config.adapterURL;
    const prevGeojsonPath = config.geojsonPath;
    (config as { vehicleCount: number }).vehicleCount = vehicles;
    (config as { adapterURL: string }).adapterURL = "";
    (config as { geojsonPath: string }).geojsonPath = geojsonPath;

    let vehicleManager: VehicleManager;
    let writer: TruthWriter | undefined;
    try {
      const roadNetwork = new RoadNetwork(geojsonPath);
      const fleetManager = new FleetManager();
      // Construct so synthetic vehicles + routes are seeded in the constructor.
      vehicleManager = new VehicleManager(roadNetwork, fleetManager);
      // IncidentManager shares the sim clock so any incident timestamps back-date
      // consistently (no Date.now() leak in the headless path).
      this.incidentManager = new IncidentManager(vehicleManager.clock);

      const clock = vehicleManager.clock;
      clock.setTime(simStart);

      const actualVehicleCount = vehicleManager.getVehicles().length;

      const header: TruthHeader = {
        format: "moveet-headless-truth",
        version: 1,
        simStart: simStart.toISOString(),
        stepMs,
        vehicleCount: actualVehicleCount,
        seed,
        network,
      };
      writer = new TruthWriter(out, header);

      log.info(
        `Generating ${steps} steps (${totalSimMs}ms @ ${stepMs}ms) for ${actualVehicleCount} vehicles from ${simStart.toISOString()} → ${out}`
      );

      for (let i = 0; i < steps; i++) {
        vehicleManager.advance(stepMs);
        writer.writeStep(clock.getState().currentTime, vehicleManager.getVehicles());
      }

      writer.close();
      writer = undefined;
      log.info(`Done: wrote ${steps} step records to ${out}`);
    } finally {
      writer?.close();
      (config as { vehicleCount: number }).vehicleCount = prevVehicleCount;
      (config as { adapterURL: string }).adapterURL = prevAdapterURL;
      (config as { geojsonPath: string }).geojsonPath = prevGeojsonPath;
      restoreRandom();
    }
  }
}

/**
 * Overrides the global `Math.random` with a seeded mulberry32 PRNG and returns a
 * restore function. The simulator seeds vehicles and routes via `Math.random`,
 * so this makes a given `--seed` reproducible on a best-effort basis.
 */
function installSeededRandom(seed: number): () => void {
  const original = Math.random;
  const rng = mulberry32(seed);
  Math.random = rng;
  return () => {
    Math.random = original;
  };
}
