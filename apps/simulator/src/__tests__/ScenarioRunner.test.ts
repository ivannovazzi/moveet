import { describe, it, expect } from "vitest";
import path from "path";
import { ScenarioRunner } from "../headless/ScenarioRunner";
import { scenarioSchema } from "../modules/scenario/types";
import type { Scenario } from "../modules/scenario/types";

const FIXTURE_PATH = path.join(__dirname, "fixtures", "integration-network.geojson");

/** A pickup/dropoff pair on opposite corners of the fixture grid. */
const PICKUP = { lat: 45.5, lng: -73.57 };
const DROPOFF = { lat: 45.504, lng: -73.564 };

/** Raw scenario input, parsed through the schema so defaults are applied. */
function makeScenario(overrides: Record<string, unknown> = {}): Scenario {
  return scenarioSchema.parse({
    name: "runner-test",
    duration: 300,
    events: [],
    ...overrides,
  });
}

const jobEvent = (at: number) => ({
  at,
  action: {
    type: "create_job",
    pickup: PICKUP,
    dropoff: DROPOFF,
    strategy: "nearest",
  },
});

/**
 * Each call builds a road network and a pathfinding-worker pool, so these tests
 * stay deliberately few and short — they are the expensive kind.
 */
function run(
  scenario: Scenario,
  opts: { vehicles?: number; seed?: number; maxSimSeconds?: number } = {}
) {
  return new ScenarioRunner({
    scenario,
    geojsonPath: FIXTURE_PATH,
    vehicles: opts.vehicles ?? 2,
    stepMs: 1000,
    seed: opts.seed ?? 42,
    maxSimSeconds: opts.maxSimSeconds,
  }).run();
}

describe("ScenarioRunner", () => {
  it("runs a scenario's jobs to completion and passes its assertions", async () => {
    const report = await run(
      makeScenario({
        events: [jobEvent(5)],
        assertions: [
          { type: "all_jobs_completed" },
          { type: "job_failures", atMost: 0 },
          { type: "job_eta_percentile", lessThanSeconds: 900 },
          { type: "no_stranded_vehicles", idleSeconds: 120 },
          { type: "fleet_avg_speed", atLeastKph: 1 },
        ],
      })
    );

    expect(report.passed).toBe(true);
    expect(report.assertions.every((a) => a.passed)).toBe(true);
    expect(report.eventErrors).toEqual([]);
    expect(report.completed).toBe(true);
    expect(report.eventsExecuted).toBe(1);
    expect(report.metrics.jobs).toMatchObject({ total: 1, complete: 1, failed: 0, unfinished: 0 });
    expect(report.metrics.jobs.etaToPickupSeconds).toHaveLength(1);
    expect(report.metrics.vehicles.count).toBe(2);
    expect(report.metrics.vehicles.totalDistanceKm).toBeGreaterThan(0);
    expect(report.simSeconds).toBe(300);
    expect(report.steps).toBe(300);
  });

  it("fails the run when an assertion does not hold", async () => {
    const report = await run(
      makeScenario({
        duration: 30,
        assertions: [
          // No fleet on this network averages 500 km/h.
          { type: "fleet_avg_speed", atLeastKph: 500 },
          { type: "no_stranded_vehicles", idleSeconds: 120 },
        ],
      })
    );

    expect(report.passed).toBe(false);
    expect(report.assertions.map((a) => a.passed)).toEqual([false, true]);
    expect(report.assertions[0].actual).toContain("km/h");
  });

  it("is deterministic for a fixed seed", async () => {
    const scenario = makeScenario({
      duration: 60,
      events: [jobEvent(5)],
      assertions: [{ type: "all_jobs_completed" }],
    });

    const a = await run(scenario, { seed: 7 });
    const b = await run(scenario, { seed: 7 });

    expect(b.metrics.vehicles.avgSpeedKph).toBe(a.metrics.vehicles.avgSpeedKph);
    expect(b.metrics.vehicles.totalDistanceKm).toBe(a.metrics.vehicles.totalDistanceKm);
    expect(b.metrics.jobs.etaToPickupSeconds).toEqual(a.metrics.jobs.etaToPickupSeconds);
    expect(b.metrics.vehicles.maxIdleSecondsById).toEqual(a.metrics.vehicles.maxIdleSecondsById);
    expect(b.assertions).toEqual(a.assertions);
  });

  it("caps the run at maxSimSeconds, grading nothing when a scenario has no assertions", async () => {
    const report = await run(
      makeScenario({ duration: 600, events: [jobEvent(5), jobEvent(500)] }),
      {
        maxSimSeconds: 30,
      }
    );

    expect(report.steps).toBe(30);
    expect(report.simSeconds).toBe(30);
    // The 500s event never came due, so the timeline never finished.
    expect(report.eventsExecuted).toBe(1);
    expect(report.completed).toBe(false);
    // Nothing to grade is not a failure.
    expect(report.assertions).toEqual([]);
    expect(report.scenario.assertionCount).toBe(0);
    expect(report.passed).toBe(true);
  });

  it("records the failure reason when a job cannot be assigned", async () => {
    const report = await run(
      makeScenario({
        duration: 10,
        events: [
          {
            at: 1,
            action: {
              type: "create_job",
              pickup: PICKUP,
              dropoff: DROPOFF,
              strategy: "manual",
              vehicleId: "not-in-this-fleet",
            },
          },
        ],
        assertions: [{ type: "all_jobs_completed" }],
      })
    );

    expect(report.passed).toBe(false);
    expect(report.metrics.jobs.failed).toBe(1);
    expect(report.metrics.jobs.errors.length).toBeGreaterThan(0);
    expect(report.assertions[0].detail).toContain(report.metrics.jobs.errors[0]);
  });

  it("rejects a run that covers no steps", async () => {
    await expect(
      new ScenarioRunner({
        scenario: makeScenario({ duration: 300 }),
        geojsonPath: FIXTURE_PATH,
        stepMs: 0,
      }).run()
    ).rejects.toThrow("stepMs must be > 0");

    await expect(
      new ScenarioRunner({
        scenario: makeScenario({ duration: 300 }),
        geojsonPath: FIXTURE_PATH,
        stepMs: 1000,
        maxSimSeconds: 0.5,
      }).run()
    ).rejects.toThrow("covers no steps");
  });
});
