import { describe, it, expect } from "vitest";
import { evaluateAssertions, percentile } from "../modules/scenario/assertions";
import type { ScenarioMetrics } from "../modules/scenario/assertions";
import { scenarioAssertionSchema } from "../modules/scenario/types";
import type { ScenarioAssertion } from "../modules/scenario/types";

function makeMetrics(overrides: Partial<ScenarioMetrics> = {}): ScenarioMetrics {
  return {
    simSeconds: 600,
    jobs: {
      total: 0,
      complete: 0,
      failed: 0,
      cancelled: 0,
      unfinished: 0,
      slaBreached: 0,
      etaToPickupSeconds: [],
      etaToDropoffSeconds: [],
      errors: [],
      ...overrides.jobs,
    },
    vehicles: {
      count: 0,
      avgSpeedKph: 0,
      totalDistanceKm: 0,
      maxIdleSecondsById: {},
      ...overrides.vehicles,
    },
    ...(overrides.simSeconds !== undefined ? { simSeconds: overrides.simSeconds } : {}),
  };
}

/** Parses through the schema so defaults (percentile, leg, atMost) are applied. */
function assertion(input: unknown): ScenarioAssertion {
  return scenarioAssertionSchema.parse(input);
}

function evaluateOne(input: unknown, metrics: ScenarioMetrics) {
  return evaluateAssertions([assertion(input)], metrics)[0];
}

describe("percentile", () => {
  it("returns null for an empty sample", () => {
    expect(percentile([], 95)).toBeNull();
  });

  it("uses nearest rank and does not mutate the input", () => {
    const values = [50, 10, 40, 20, 30];
    expect(percentile(values, 100)).toBe(50);
    expect(percentile(values, 95)).toBe(50);
    expect(percentile(values, 60)).toBe(30);
    expect(percentile(values, 1)).toBe(10);
    expect(values).toEqual([50, 10, 40, 20, 30]);
  });

  it("handles a single-value sample at any percentile", () => {
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([7], 99)).toBe(7);
  });
});

describe("evaluateAssertions", () => {
  it("returns nothing for an empty assertion list", () => {
    expect(evaluateAssertions([], makeMetrics())).toEqual([]);
  });

  describe("all_jobs_completed", () => {
    it("passes when every job completed", () => {
      const result = evaluateOne(
        { type: "all_jobs_completed" },
        makeMetrics({ jobs: { total: 3, complete: 3 } as ScenarioMetrics["jobs"] })
      );
      expect(result.passed).toBe(true);
      expect(result.actual).toBe("3/3 jobs complete");
    });

    it("fails and names the shortfall", () => {
      const result = evaluateOne(
        { type: "all_jobs_completed", label: "delivered" },
        makeMetrics({
          jobs: {
            total: 4,
            complete: 1,
            failed: 2,
            cancelled: 0,
            unfinished: 1,
          } as ScenarioMetrics["jobs"],
        })
      );
      expect(result.passed).toBe(false);
      expect(result.label).toBe("delivered");
      expect(result.detail).toContain("1 unfinished");
      expect(result.detail).toContain("2 failed");
    });
  });

  describe("job_completion_rate", () => {
    it("passes at exactly the threshold", () => {
      const result = evaluateOne(
        { type: "job_completion_rate", atLeast: 0.5 },
        makeMetrics({ jobs: { total: 4, complete: 2 } as ScenarioMetrics["jobs"] })
      );
      expect(result.passed).toBe(true);
      expect(result.actual).toContain("0.5");
    });

    it("fails below the threshold", () => {
      const result = evaluateOne(
        { type: "job_completion_rate", atLeast: 0.9 },
        makeMetrics({ jobs: { total: 4, complete: 2 } as ScenarioMetrics["jobs"] })
      );
      expect(result.passed).toBe(false);
    });

    it("treats a run with no jobs as a pass", () => {
      const result = evaluateOne({ type: "job_completion_rate", atLeast: 1 }, makeMetrics());
      expect(result.passed).toBe(true);
    });
  });

  describe("job_failures", () => {
    it("defaults to allowing none", () => {
      const parsed = assertion({ type: "job_failures" });
      expect(parsed).toMatchObject({ atMost: 0 });

      const result = evaluateAssertions(
        [parsed],
        makeMetrics({ jobs: { total: 1, failed: 1 } as ScenarioMetrics["jobs"] })
      )[0];
      expect(result.passed).toBe(false);
      expect(result.actual).toBe("1 failed");
    });

    it("passes at the allowance", () => {
      const result = evaluateOne(
        { type: "job_failures", atMost: 2 },
        makeMetrics({ jobs: { total: 5, failed: 2 } as ScenarioMetrics["jobs"] })
      );
      expect(result.passed).toBe(true);
    });
  });

  describe("job_eta_percentile", () => {
    it("defaults to p95 on the pickup leg", () => {
      expect(assertion({ type: "job_eta_percentile", lessThanSeconds: 100 })).toMatchObject({
        percentile: 95,
        leg: "pickup",
      });
    });

    it("passes when the percentile is under the threshold", () => {
      const result = evaluateOne(
        { type: "job_eta_percentile", percentile: 95, leg: "pickup", lessThanSeconds: 300 },
        makeMetrics({
          jobs: { total: 3, etaToPickupSeconds: [100, 150, 299] } as ScenarioMetrics["jobs"],
        })
      );
      expect(result.passed).toBe(true);
      expect(result.actual).toContain("n=3");
    });

    it("fails when the percentile reaches the threshold", () => {
      const result = evaluateOne(
        { type: "job_eta_percentile", percentile: 95, leg: "pickup", lessThanSeconds: 300 },
        makeMetrics({
          jobs: { total: 2, etaToPickupSeconds: [100, 300] } as ScenarioMetrics["jobs"],
        })
      );
      expect(result.passed).toBe(false);
    });

    it("reads the dropoff leg when asked", () => {
      const result = evaluateOne(
        { type: "job_eta_percentile", percentile: 50, leg: "dropoff", lessThanSeconds: 900 },
        makeMetrics({
          jobs: {
            total: 2,
            etaToPickupSeconds: [10_000],
            etaToDropoffSeconds: [400, 500],
          } as ScenarioMetrics["jobs"],
        })
      );
      expect(result.passed).toBe(true);
      expect(result.actual).toContain("400s");
    });

    it("fails when there is nothing to measure", () => {
      const result = evaluateOne(
        { type: "job_eta_percentile", lessThanSeconds: 900 },
        makeMetrics()
      );
      expect(result.passed).toBe(false);
      expect(result.actual).toBe("no assigned jobs to measure");
    });
  });

  describe("no_stranded_vehicles", () => {
    it("defaults the idle allowance to 120s", () => {
      expect(assertion({ type: "no_stranded_vehicles" })).toMatchObject({ idleSeconds: 120 });
    });

    it("passes when every vehicle stayed inside the allowance", () => {
      const result = evaluateOne(
        { type: "no_stranded_vehicles", idleSeconds: 60 },
        makeMetrics({
          vehicles: {
            count: 2,
            avgSpeedKph: 30,
            totalDistanceKm: 5,
            maxIdleSecondsById: { a: 60, b: 12 },
          },
        })
      );
      expect(result.passed).toBe(true);
      expect(result.actual).toContain("worst idle 60s");
    });

    it("fails and lists the worst offenders first", () => {
      const result = evaluateOne(
        { type: "no_stranded_vehicles", idleSeconds: 30 },
        makeMetrics({
          vehicles: {
            count: 3,
            avgSpeedKph: 1,
            totalDistanceKm: 0.1,
            maxIdleSecondsById: { a: 40, b: 10, c: 400 },
          },
        })
      );
      expect(result.passed).toBe(false);
      expect(result.detail?.startsWith("c idle 400s")).toBe(true);
      expect(result.detail).toContain("a idle 40s");
      expect(result.detail).not.toContain("b idle");
    });
  });

  describe("fleet_avg_speed", () => {
    it("passes above the floor with no ceiling", () => {
      const result = evaluateOne(
        { type: "fleet_avg_speed", atLeastKph: 10 },
        makeMetrics({
          vehicles: {
            count: 2,
            avgSpeedKph: 22.5,
            totalDistanceKm: 3,
            maxIdleSecondsById: {},
          },
        })
      );
      expect(result.passed).toBe(true);
      expect(result.expected).toBe(">= 10 km/h");
      expect(result.actual).toBe("22.5 km/h (2 vehicles)");
    });

    it("fails below the floor", () => {
      const result = evaluateOne(
        { type: "fleet_avg_speed", atLeastKph: 10 },
        makeMetrics({
          vehicles: { count: 1, avgSpeedKph: 2, totalDistanceKm: 0, maxIdleSecondsById: {} },
        })
      );
      expect(result.passed).toBe(false);
    });

    it("enforces a ceiling when one is given", () => {
      const metrics = makeMetrics({
        vehicles: { count: 1, avgSpeedKph: 95, totalDistanceKm: 9, maxIdleSecondsById: {} },
      });
      const result = evaluateOne(
        { type: "fleet_avg_speed", atLeastKph: 5, atMostKph: 80 },
        metrics
      );
      expect(result.passed).toBe(false);
      expect(result.expected).toBe("5..80 km/h");
    });
  });

  it("grades a mixed list independently", () => {
    const metrics = makeMetrics({
      jobs: {
        total: 2,
        complete: 1,
        failed: 1,
        cancelled: 0,
        unfinished: 0,
        slaBreached: 0,
        etaToPickupSeconds: [120, 200],
        etaToDropoffSeconds: [400, 500],
        errors: [],
      },
      vehicles: {
        count: 1,
        avgSpeedKph: 25,
        totalDistanceKm: 4,
        maxIdleSecondsById: { a: 5 },
      },
    });

    const results = evaluateAssertions(
      [
        assertion({ type: "all_jobs_completed" }),
        assertion({ type: "job_eta_percentile", lessThanSeconds: 300 }),
        assertion({ type: "no_stranded_vehicles", idleSeconds: 60 }),
      ],
      metrics
    );

    expect(results.map((r) => r.passed)).toEqual([false, true, true]);
    expect(results.map((r) => r.type)).toEqual([
      "all_jobs_completed",
      "job_eta_percentile",
      "no_stranded_vehicles",
    ]);
  });
});
