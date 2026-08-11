import { RoadNetwork } from "../modules/RoadNetwork";
import { VehicleManager } from "../modules/VehicleManager";
import { FleetManager } from "../modules/FleetManager";
import { IncidentManager } from "../modules/IncidentManager";
import { JobManager } from "../modules/JobManager";
import { SimulationController } from "../modules/SimulationController";
import { ScenarioManager } from "../modules/scenario/ScenarioManager";
import { evaluateAssertions } from "../modules/scenario/assertions";
import type { AssertionResult, ScenarioMetrics } from "../modules/scenario/assertions";
import type { Scenario } from "../modules/scenario/types";
import { config } from "../utils/config";
import { createLogger } from "../utils/logger";
import { installSeededRandom } from "./seededRandom";
import { TERMINAL_JOB_STATUSES } from "@moveet/shared-types";

const log = createLogger("scenario-runner");

/** Steps processed between event-loop yields (lets worker replies land). */
const DEFAULT_CHUNK_STEPS = 50;

/** Simulated milliseconds advanced per step when the caller doesn't say. */
const DEFAULT_STEP_MS = 1000;

/** Simulated seconds between `JobManager.sweep()` calls. */
const DEFAULT_JOB_SWEEP_SECONDS = 1;

/** Wall-clock budget per step for in-flight pathfinding to settle. */
const DEFAULT_DRAIN_MS = 2000;

/**
 * Waits for the pathfinding a step kicked off to land, so every route is applied
 * within the step that asked for it.
 *
 * Two passes, each `setImmediate` then drain, because a request is not
 * registered with the pool synchronously: the movement code calls the async
 * pathfinder without awaiting it, so the request appears a microtask later.
 * Draining immediately would find an empty queue and return at once, letting the
 * route land at whatever later step the worker happened to reply on — the exact
 * wall-clock dependence a seeded run is supposed to be free of.
 */
async function settlePathfinding(roadNetwork: RoadNetwork, drainMs: number): Promise<void> {
  for (let pass = 0; pass < 2; pass++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await roadNetwork.drainPathfinding(drainMs);
  }
}

export interface ScenarioRunnerOptions {
  /** The parsed, validated scenario to run. */
  scenario: Scenario;
  /** Path to the GeoJSON road network. */
  geojsonPath: string;
  /**
   * Synthetic vehicles to seed before the timeline starts. A scenario that
   * spawns its own fleet with `spawn_vehicles` can leave this at 0.
   */
  vehicles?: number;
  /** Simulated milliseconds per step. Default 1000. */
  stepMs?: number;
  /** RNG seed — the whole point of the harness is that this reproduces. */
  seed?: number;
  /** Absolute start of the simulated window. Defaults to the clock's own start. */
  simStart?: Date;
  /**
   * Hard cap on simulated seconds, overriding the scenario's own `duration`.
   * Useful to smoke-test a long scenario in CI without editing the file.
   */
  maxSimSeconds?: number;
  /** Steps between event-loop yields. */
  chunkSteps?: number;
  /** Simulated seconds between job sweeps (SLA + pending-queue retry). */
  jobSweepSeconds?: number;
  /**
   * Milliseconds to wait for in-flight pathfinding to settle at each step
   * boundary. This is what makes a run REPRODUCIBLE: A* runs on worker threads,
   * so without a drain a route lands at whatever step the worker happened to
   * reply on, and the same seed produces slightly different movement each run.
   * `0` disables the drain — faster on a large fleet, but no longer deterministic.
   */
  drainPathfindingMs?: number;
}

/** An action that threw while the timeline ran. */
export interface ScenarioEventError {
  at: number;
  action: string;
  error: string;
}

/** The full result of a headless scenario run — the CI artifact. */
export interface ScenarioRunReport {
  scenario: {
    name: string;
    description?: string;
    duration: number;
    eventCount: number;
    assertionCount: number;
  };
  seed: number;
  stepMs: number;
  steps: number;
  /** Simulated seconds actually covered. */
  simSeconds: number;
  eventsExecuted: number;
  /** True when the timeline ran to the authored duration. */
  completed: boolean;
  eventErrors: ScenarioEventError[];
  metrics: ScenarioMetrics;
  assertions: AssertionResult[];
  /** Every assertion held AND no action threw. This is the exit code. */
  passed: boolean;
  /** Wall-clock milliseconds the run took (reporting only — never simulated). */
  wallMs: number;
}

/**
 * Runs a scenario headlessly and grades it against its own assertions.
 *
 * The regression harness. It builds the real module graph — road network,
 * VehicleManager, IncidentManager, JobManager, ScenarioManager — and drives it
 * on an explicit `stepMs` clock with NO `setInterval` and NO wall-clock timing,
 * exactly like {@link HeadlessRunner} does for recording generation. The
 * scenario's events fire on simulated time (`ScenarioManager.advance`), so a
 * 10-minute scenario grades in a second of CI time and lands its events at the
 * simulated seconds it authored, not wherever the fast-forward happened to be.
 *
 * The fleet is always synthetic and seeded: a harness whose verdict depends on
 * whatever an external source returned today is not a regression test.
 */
export class ScenarioRunner {
  /** Current and longest run of stationary simulated seconds, per vehicle id. */
  private idleStreakSeconds = new Map<string, number>();
  private maxIdleSeconds = new Map<string, number>();
  /** Previous sampled true position, for the movement check in {@link sampleIdle}. */
  private lastPositions = new Map<string, [number, number]>();

  constructor(private readonly opts: ScenarioRunnerOptions) {}

  async run(): Promise<ScenarioRunReport> {
    const { scenario, geojsonPath } = this.opts;
    const stepMs = this.opts.stepMs ?? DEFAULT_STEP_MS;
    const seed = this.opts.seed ?? 1;
    const chunkSteps = this.opts.chunkSteps ?? DEFAULT_CHUNK_STEPS;
    const sweepSeconds = this.opts.jobSweepSeconds ?? DEFAULT_JOB_SWEEP_SECONDS;
    const vehicles = this.opts.vehicles ?? 0;
    const drainMs = this.opts.drainPathfindingMs ?? DEFAULT_DRAIN_MS;

    if (stepMs <= 0) throw new Error("stepMs must be > 0");

    const simSecondsTarget = this.opts.maxSimSeconds ?? scenario.duration;
    const steps = Math.floor((simSecondsTarget * 1000) / stepMs);
    if (steps <= 0) throw new Error("The run covers no steps; raise maxSimSeconds or lower stepMs");

    const wallStart = Date.now();
    const restoreRandom = installSeededRandom(seed);

    // Synthetic, deterministic fleet: an empty adapterURL makes the
    // VehicleManager constructor seed `vehicleCount` vehicles locally.
    const prevVehicleCount = config.vehicleCount;
    const prevAdapterURL = config.adapterURL;
    const prevGeojsonPath = config.geojsonPath;
    (config as { geojsonPath: string }).geojsonPath = geojsonPath;
    (config as { vehicleCount: number }).vehicleCount = vehicles;
    (config as { adapterURL: string }).adapterURL = "";

    let jobManager: JobManager | undefined;
    let roadNetwork: RoadNetwork | undefined;

    try {
      roadNetwork = new RoadNetwork(geojsonPath);
      const fleetManager = new FleetManager();
      const vehicleManager = new VehicleManager(roadNetwork, fleetManager);
      const clock = vehicleManager.clock;
      if (this.opts.simStart) clock.setTime(this.opts.simStart);
      // Dwell on simulated time, or every vehicle parks at its first stop for
      // the rest of the (wall-clock-instant) run. See RouteManager.setTimeSource.
      vehicleManager.routeManager.setTimeSource(() => clock.now());

      const incidentManager = new IncidentManager(clock);
      const simulationController = new SimulationController(vehicleManager, incidentManager);
      jobManager = new JobManager(vehicleManager);
      const scenarioManager = new ScenarioManager(
        vehicleManager,
        incidentManager,
        simulationController,
        jobManager
      );

      const eventErrors: ScenarioEventError[] = [];
      scenarioManager.on("scenario:event-error", (payload: ScenarioEventError) => {
        eventErrors.push({ at: payload.at, action: payload.action, error: payload.error });
      });
      let completed = false;
      scenarioManager.on("scenario:completed", () => {
        completed = true;
      });

      // The synthetic fleet asks for its first routes inside the VehicleManager
      // constructor. Settling them before the timeline starts means step 1 sees a
      // routed fleet in every run, instead of a fleet whose routes may or may not
      // have landed depending on how fast the workers spun up.
      if (drainMs > 0) await settlePathfinding(roadNetwork, drainMs);

      scenarioManager.loadScenario(scenario);
      scenarioManager.startManual();

      log.info(
        `Running scenario "${scenario.name}": ${steps} steps @ ${stepMs}ms ` +
          `(${simSecondsTarget}s simulated), ${scenario.events.length} events, ` +
          `${scenario.assertions?.length ?? 0} assertions, seed ${seed}`
      );

      const sweepEveryMs = sweepSeconds * 1000;
      let sinceSweepMs = 0;
      let step = 0;

      while (step < steps) {
        const chunkEnd = Math.min(step + chunkSteps, steps);
        for (; step < chunkEnd; step++) {
          // Timeline first: an event scheduled at this simulated second takes
          // effect before the vehicles move through it.
          await scenarioManager.advance(stepMs);
          vehicleManager.advance(stepMs);
          if (drainMs > 0) await settlePathfinding(roadNetwork, drainMs);
          this.sampleIdle(vehicleManager, stepMs);

          sinceSweepMs += stepMs;
          if (sinceSweepMs >= sweepEveryMs) {
            sinceSweepMs = 0;
            // The 1 Hz sweep the live JobManager runs on a timer: retries the
            // pending queue so a job that found no routable vehicle at creation
            // still gets assigned once one frees up.
            await jobManager.sweep();
          }
        }
        if (drainMs === 0) {
          // With draining off nothing else yields, and pathfinding-worker
          // replies only land between macrotasks.
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }

      const simSeconds = (steps * stepMs) / 1000;
      const metrics = this.collectMetrics(vehicleManager, jobManager, simSeconds);
      const assertions = evaluateAssertions(scenario.assertions ?? [], metrics);
      const passed = assertions.every((a) => a.passed) && eventErrors.length === 0;

      return {
        scenario: {
          name: scenario.name,
          description: scenario.description,
          duration: scenario.duration,
          eventCount: scenario.events.length,
          assertionCount: scenario.assertions?.length ?? 0,
        },
        seed,
        stepMs,
        steps,
        simSeconds,
        eventsExecuted: scenarioManager.getStatus().eventsExecuted,
        completed,
        eventErrors,
        metrics,
        assertions,
        passed,
        wallMs: Date.now() - wallStart,
      };
    } finally {
      // The sweep interval is unref'd, but leaving it running would keep
      // assigning against a dead graph in a long-lived process (the tests).
      jobManager?.dispose();
      // Pathfinding workers are NOT unref'd: without this a CLI run would hang
      // after printing its verdict, and a test run would leak a thread per case.
      await roadNetwork?.shutdownWorkers();
      (config as { vehicleCount: number }).vehicleCount = prevVehicleCount;
      (config as { adapterURL: string }).adapterURL = prevAdapterURL;
      (config as { geojsonPath: string }).geojsonPath = prevGeojsonPath;
      restoreRandom();
    }
  }

  /**
   * Accumulates per-vehicle stationary streaks, in simulated seconds.
   *
   * Movement is judged by POSITION, not by the reported speed: a dwelling or
   * blocked vehicle can still carry a non-zero speed (the speed model floors it
   * at `minSpeed` while `dwellUntil` holds the vehicle in place), so a
   * speed-based check would report a parked fleet as healthy. True positions are
   * used, so an injected GPS fault cannot fake movement either.
   *
   * Sampled every step rather than read at the end, because "did anything get
   * stuck" is a question about the whole run: a vehicle that was stranded for
   * five minutes and then freed looks perfectly healthy in a final snapshot.
   */
  private sampleIdle(vehicleManager: VehicleManager, stepMs: number): void {
    const stepSeconds = stepMs / 1000;
    for (const vehicle of vehicleManager.getTrueVehicles()) {
      const [lat, lng] = vehicle.position;
      const previous = this.lastPositions.get(vehicle.id);
      const moved = previous === undefined || previous[0] !== lat || previous[1] !== lng;
      this.lastPositions.set(vehicle.id, [lat, lng]);

      const streak = moved ? 0 : (this.idleStreakSeconds.get(vehicle.id) ?? 0) + stepSeconds;
      this.idleStreakSeconds.set(vehicle.id, streak);
      this.maxIdleSeconds.set(
        vehicle.id,
        Math.max(this.maxIdleSeconds.get(vehicle.id) ?? 0, streak)
      );
    }
  }

  private collectMetrics(
    vehicleManager: VehicleManager,
    jobManager: JobManager,
    simSeconds: number
  ): ScenarioMetrics {
    const jobs = jobManager.getJobs();
    const terminal = new Set<string>(TERMINAL_JOB_STATUSES);

    const etaToPickupSeconds: number[] = [];
    const etaToDropoffSeconds: number[] = [];
    const errors = new Set<string>();
    let complete = 0;
    let failed = 0;
    let cancelled = 0;
    let unfinished = 0;
    let slaBreached = 0;

    for (const job of jobs) {
      if (job.error) errors.add(job.error);
      if (job.status === "complete") complete++;
      else if (job.status === "failed") failed++;
      else if (job.status === "cancelled") cancelled++;
      if (!terminal.has(job.status)) unfinished++;
      if (job.slaBreached) slaBreached++;
      if (job.etaToPickupSeconds !== undefined) etaToPickupSeconds.push(job.etaToPickupSeconds);
      if (job.etaToDropoffSeconds !== undefined) etaToDropoffSeconds.push(job.etaToDropoffSeconds);
    }

    const stats = vehicleManager.analytics.getAllStats();
    const roster = vehicleManager.getTrueVehicles();
    let speedSum = 0;
    let distanceSum = 0;
    for (const vehicle of roster) {
      const vs = stats.get(vehicle.id);
      // A vehicle with no stats never ticked; it counts as 0 km/h rather than
      // being dropped, so a fleet that never moved cannot average away to a pass.
      speedSum += vs?.avgSpeed ?? 0;
      distanceSum += vs?.distanceTraveled ?? 0;
    }

    return {
      simSeconds,
      jobs: {
        total: jobs.length,
        complete,
        failed,
        cancelled,
        unfinished,
        slaBreached,
        etaToPickupSeconds,
        etaToDropoffSeconds,
        errors: [...errors],
      },
      vehicles: {
        count: roster.length,
        avgSpeedKph: roster.length === 0 ? 0 : speedSum / roster.length,
        totalDistanceKm: distanceSum,
        maxIdleSecondsById: Object.fromEntries(this.maxIdleSeconds),
      },
    };
  }
}
