import { z } from "zod";
import {
  incidentTypeEnum,
  jobStopSchema,
  jobStrategyEnum,
  optionsSchema,
  trafficProfileSchema,
  waypointRequestSchema,
} from "../../middleware/schemas";

// ─── Timeline event actions ─────────────────────────────────────────

export const spawnVehiclesActionSchema = z.object({
  type: z.literal("spawn_vehicles"),
  count: z.number().int().positive("count must be a positive integer"),
  vehicleTypes: z.record(z.string(), z.number().int().nonnegative()).optional(),
});

export const createIncidentBaseSchema = z.object({
  type: z.literal("create_incident"),
  edgeIds: z.array(z.string()).optional(),
  position: z
    .object({
      lat: z.number(),
      lng: z.number(),
    })
    .optional(),
  incidentType: incidentTypeEnum,
  duration: z.number().positive("duration must be a positive number"),
  severity: z.number().min(0).max(1).optional(),
});

export const dispatchActionSchema = z.object({
  type: z.literal("dispatch"),
  vehicleId: z.string().min(1, "vehicleId must be a non-empty string"),
  waypoints: z.array(waypointRequestSchema).nonempty("waypoints must be a non-empty array"),
});

export const setTrafficProfileActionSchema = z.object({
  type: z.literal("set_traffic_profile"),
  name: z.string().min(1, "name must be a non-empty string"),
  timeRanges: trafficProfileSchema.shape.timeRanges,
});

export const clearIncidentsActionSchema = z.object({
  type: z.literal("clear_incidents"),
  incidentIds: z.array(z.string()).optional(),
});

export const setOptionsActionSchema = z.object({
  type: z.literal("set_options"),
  options: optionsSchema.partial(),
});

/**
 * Creates a job (pickup + dropoff) through the real `JobManager`, so a scenario
 * can exercise the dispatch lifecycle the assertions are written against
 * ("every job completed", "p95 ETA to pickup under N seconds").
 */
export const createJobActionSchema = z.object({
  type: z.literal("create_job"),
  pickup: jobStopSchema,
  dropoff: jobStopSchema,
  strategy: jobStrategyEnum.optional(),
  /** Required when `strategy` is `manual`. */
  vehicleId: z.string().min(1).optional(),
  slaSeconds: z.number().int().min(1).max(86_400).optional(),
});

// ─── Discriminated union of all actions ─────────────────────────────

export const scenarioActionSchema = z.discriminatedUnion("type", [
  spawnVehiclesActionSchema,
  createIncidentBaseSchema,
  dispatchActionSchema,
  setTrafficProfileActionSchema,
  clearIncidentsActionSchema,
  setOptionsActionSchema,
  createJobActionSchema,
]);

// ─── Timeline event ─────────────────────────────────────────────────

export const scenarioEventSchema = z
  .object({
    at: z.number().nonnegative("at must be a non-negative number (seconds from start)"),
    action: scenarioActionSchema,
  })
  .refine(
    (event) => {
      if (event.action.type !== "create_incident") return true;
      return event.action.edgeIds !== undefined || event.action.position !== undefined;
    },
    {
      message: "At least one of 'edgeIds' or 'position' must be provided",
      path: ["action"],
    }
  );

// ─── Scenario metadata ──────────────────────────────────────────────

export const scenarioMetadataSchema = z.object({
  name: z.string().min(1, "name must be a non-empty string"),
  description: z.string().optional(),
  city: z.string().optional(),
  duration: z.number().positive("duration must be a positive number (seconds)"),
});

// ─── Variables ──────────────────────────────────────────────────────

export const scenarioVariablesSchema = z.record(z.string(), z.union([z.string(), z.number()]));

// ─── Assertions ─────────────────────────────────────────────────────
//
// Assertions are the pass/fail contract of a scenario: they turn a run into a
// regression test. They are evaluated ONCE, against the metrics collected over
// the whole run, by the headless runner (`headless/ScenarioRunner.ts`) — the
// live, wall-clock `ScenarioManager` ignores them, because a scenario an
// operator drives from the UI has no exit code to fail.

/** Every job the scenario created reached `complete`. */
export const allJobsCompletedAssertionSchema = z.object({
  type: z.literal("all_jobs_completed"),
  label: z.string().optional(),
});

/** Completed / created, as a ratio in [0, 1]. A run with no jobs scores 1. */
export const jobCompletionRateAssertionSchema = z.object({
  type: z.literal("job_completion_rate"),
  atLeast: z.number().min(0).max(1),
  label: z.string().optional(),
});

/** Cap on jobs that ended `failed` (no routable vehicle, dropped mid-trip). */
export const jobFailuresAssertionSchema = z.object({
  type: z.literal("job_failures"),
  atMost: z.number().int().nonnegative().default(0),
  label: z.string().optional(),
});

/**
 * Percentile of the assignment ETA across jobs, in seconds. `leg: "pickup"` is
 * the response-time question (how long until a unit arrives); `leg: "dropoff"`
 * is the whole two-leg trip.
 */
export const jobEtaPercentileAssertionSchema = z.object({
  type: z.literal("job_eta_percentile"),
  percentile: z.number().min(1).max(100).default(95),
  leg: z.enum(["pickup", "dropoff"]).default("pickup"),
  lessThanSeconds: z.number().positive(),
  label: z.string().optional(),
});

/**
 * No vehicle sat still for longer than `idleSeconds` of SIMULATED time. This is
 * the "nothing got stuck" check: an unroutable vehicle, a vehicle boxed in by a
 * closure, or one whose dwell never released all show up as a long idle streak.
 */
export const noStrandedVehiclesAssertionSchema = z.object({
  type: z.literal("no_stranded_vehicles"),
  idleSeconds: z.number().positive().default(120),
  label: z.string().optional(),
});

/** Fleet-mean speed band, km/h. Catches a network-wide gridlock regression. */
export const fleetAvgSpeedAssertionSchema = z.object({
  type: z.literal("fleet_avg_speed"),
  atLeastKph: z.number().nonnegative(),
  atMostKph: z.number().positive().optional(),
  label: z.string().optional(),
});

export const scenarioAssertionSchema = z.discriminatedUnion("type", [
  allJobsCompletedAssertionSchema,
  jobCompletionRateAssertionSchema,
  jobFailuresAssertionSchema,
  jobEtaPercentileAssertionSchema,
  noStrandedVehiclesAssertionSchema,
  fleetAvgSpeedAssertionSchema,
]);

// ─── Top-level scenario schema ──────────────────────────────────────

export const scenarioSchema = scenarioMetadataSchema.extend({
  version: z.literal(1).default(1),
  variables: scenarioVariablesSchema.optional(),
  events: z.array(scenarioEventSchema),
  assertions: z.array(scenarioAssertionSchema).optional(),
});

// ─── Inferred TypeScript types ──────────────────────────────────────

export type SpawnVehiclesAction = z.infer<typeof spawnVehiclesActionSchema>;
export type CreateIncidentAction = z.infer<typeof createIncidentBaseSchema>;
export type DispatchAction = z.infer<typeof dispatchActionSchema>;
export type SetTrafficProfileAction = z.infer<typeof setTrafficProfileActionSchema>;
export type ClearIncidentsAction = z.infer<typeof clearIncidentsActionSchema>;
export type SetOptionsAction = z.infer<typeof setOptionsActionSchema>;
export type CreateJobAction = z.infer<typeof createJobActionSchema>;
export type ScenarioAction = z.infer<typeof scenarioActionSchema>;
export type ScenarioEvent = z.infer<typeof scenarioEventSchema>;
export type ScenarioAssertion = z.infer<typeof scenarioAssertionSchema>;
export type ScenarioVariables = z.infer<typeof scenarioVariablesSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;

// ─── Runtime status ─────────────────────────────────────────────────

export type ScenarioState = "idle" | "running" | "paused";

export interface ScenarioStatus {
  state: ScenarioState;
  scenario: { name: string; duration: number; eventCount: number } | null;
  elapsed: number; // seconds elapsed
  eventIndex: number; // next event index
  eventsExecuted: number;
  upcomingEvents: Array<{ at: number; type: string }>; // next 5 events
}
