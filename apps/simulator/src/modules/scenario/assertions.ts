import type { ScenarioAssertion } from "./types";

/**
 * Job-side aggregate of a scenario run. Counted from the real `JobDTO`s the
 * `JobManager` holds when the run ends, so a status here is the same status the
 * job board and the WS `job:updated` stream reported.
 */
export interface ScenarioJobMetrics {
  total: number;
  complete: number;
  failed: number;
  cancelled: number;
  /** Jobs that were still pending/assigned/en_route/on_scene/transporting at the end. */
  unfinished: number;
  slaBreached: number;
  /** Assignment ETA to the pickup, seconds — one entry per job that got assigned. */
  etaToPickupSeconds: number[];
  /** Assignment ETA for the whole two-leg trip, seconds. */
  etaToDropoffSeconds: number[];
  /**
   * Distinct `job.error` strings seen on the run, so a failing assertion can say
   * WHY the jobs failed instead of only that they did.
   */
  errors: string[];
}

/** Vehicle-side aggregate of a scenario run. */
export interface ScenarioVehicleMetrics {
  count: number;
  /** Fleet mean of the per-vehicle average speed, km/h. */
  avgSpeedKph: number;
  totalDistanceKm: number;
  /**
   * Longest run of SIMULATED seconds each vehicle spent stationary, keyed by
   * vehicle id. The stranded assertion thresholds this; the runner samples it
   * every step, so it covers the whole run rather than just the final frame.
   */
  maxIdleSecondsById: Record<string, number>;
}

/** Everything the assertions are evaluated against. */
export interface ScenarioMetrics {
  /** Simulated seconds the run covered. */
  simSeconds: number;
  jobs: ScenarioJobMetrics;
  vehicles: ScenarioVehicleMetrics;
}

/** One assertion's verdict. `passed === false` is what fails a CI run. */
export interface AssertionResult {
  type: ScenarioAssertion["type"];
  /** The scenario's own label when it set one, otherwise a generated one. */
  label: string;
  passed: boolean;
  /** What the assertion asked for, human-readable. */
  expected: string;
  /** What the run produced, human-readable. */
  actual: string;
  /** Extra context on a failure (offending vehicles, missing statuses). */
  detail?: string;
}

/**
 * Nearest-rank percentile over an unsorted sample. Returns `null` for an empty
 * sample so callers can distinguish "no data" from "zero".
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank: rank = ceil(p/100 * N), clamped into the array.
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

/** Why the jobs didn't all land: the status split, plus any reported errors. */
function shortfallDetail(jobs: ScenarioJobMetrics): string {
  const split = `${jobs.unfinished} unfinished, ${jobs.failed} failed, ${jobs.cancelled} cancelled`;
  return jobs.errors.length === 0 ? split : `${split}; ${jobs.errors.join("; ")}`;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Evaluates every assertion against the collected metrics.
 *
 * Pure and synchronous: the run is over by the time this is called, which is
 * what makes a scenario's verdict reproducible from its report alone.
 */
export function evaluateAssertions(
  assertions: ScenarioAssertion[],
  metrics: ScenarioMetrics
): AssertionResult[] {
  return assertions.map((assertion) => evaluateAssertion(assertion, metrics));
}

function evaluateAssertion(
  assertion: ScenarioAssertion,
  metrics: ScenarioMetrics
): AssertionResult {
  const { jobs, vehicles } = metrics;

  switch (assertion.type) {
    case "all_jobs_completed": {
      const passed = jobs.total === jobs.complete;
      return {
        type: assertion.type,
        label: assertion.label ?? "all jobs completed",
        passed,
        expected: `${jobs.total}/${jobs.total} jobs complete`,
        actual: `${jobs.complete}/${jobs.total} jobs complete`,
        detail: passed ? undefined : shortfallDetail(jobs),
      };
    }

    case "job_completion_rate": {
      // A run that created no jobs vacuously satisfies a rate: there is no
      // dispatch behaviour to regress. Failing it would make an assertion list
      // reusable across scenarios impossible.
      const rate = jobs.total === 0 ? 1 : jobs.complete / jobs.total;
      const passed = rate >= assertion.atLeast;
      return {
        type: assertion.type,
        label: assertion.label ?? `job completion rate >= ${assertion.atLeast}`,
        passed,
        expected: `>= ${assertion.atLeast}`,
        actual: `${round(rate, 4)} (${jobs.complete}/${jobs.total})`,
      };
    }

    case "job_failures": {
      const passed = jobs.failed <= assertion.atMost;
      return {
        type: assertion.type,
        label: assertion.label ?? `failed jobs <= ${assertion.atMost}`,
        passed,
        expected: `<= ${assertion.atMost} failed`,
        actual: `${jobs.failed} failed`,
        detail: passed || jobs.errors.length === 0 ? undefined : jobs.errors.join("; "),
      };
    }

    case "job_eta_percentile": {
      const sample =
        assertion.leg === "pickup" ? jobs.etaToPickupSeconds : jobs.etaToDropoffSeconds;
      const value = percentile(sample, assertion.percentile);
      const label =
        assertion.label ??
        `p${assertion.percentile} ETA to ${assertion.leg} < ${assertion.lessThanSeconds}s`;

      if (value === null) {
        // No assigned job means the scenario never exercised what this asserts.
        // Reporting that as a pass would hide a dispatch failure behind a green
        // run, so an empty sample fails.
        return {
          type: assertion.type,
          label,
          passed: false,
          expected: `< ${assertion.lessThanSeconds}s`,
          actual: "no assigned jobs to measure",
        };
      }

      return {
        type: assertion.type,
        label,
        passed: value < assertion.lessThanSeconds,
        expected: `< ${assertion.lessThanSeconds}s`,
        actual: `${round(value)}s (n=${sample.length})`,
      };
    }

    case "no_stranded_vehicles": {
      const offenders = Object.entries(vehicles.maxIdleSecondsById)
        .filter(([, idle]) => idle > assertion.idleSeconds)
        .sort((a, b) => b[1] - a[1]);
      const worst = Object.values(vehicles.maxIdleSecondsById).reduce(
        (max, idle) => Math.max(max, idle),
        0
      );
      return {
        type: assertion.type,
        label: assertion.label ?? `no vehicle idle for more than ${assertion.idleSeconds}s`,
        passed: offenders.length === 0,
        expected: `max idle <= ${assertion.idleSeconds}s`,
        actual: `${offenders.length} stranded, worst idle ${round(worst)}s`,
        detail:
          offenders.length === 0
            ? undefined
            : offenders
                .slice(0, 5)
                .map(([id, idle]) => `${id} idle ${round(idle)}s`)
                .join(", "),
      };
    }

    case "fleet_avg_speed": {
      const avg = vehicles.avgSpeedKph;
      const aboveFloor = avg >= assertion.atLeastKph;
      const belowCeiling = assertion.atMostKph === undefined || avg <= assertion.atMostKph;
      const band =
        assertion.atMostKph === undefined
          ? `>= ${assertion.atLeastKph} km/h`
          : `${assertion.atLeastKph}..${assertion.atMostKph} km/h`;
      return {
        type: assertion.type,
        label: assertion.label ?? `fleet average speed ${band}`,
        passed: aboveFloor && belowCeiling,
        expected: band,
        actual: `${round(avg)} km/h (${vehicles.count} vehicles)`,
      };
    }
  }
}
