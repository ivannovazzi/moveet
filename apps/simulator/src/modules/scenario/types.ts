import { z } from "zod";
import {
  incidentTypeEnum,
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

const createIncidentBaseSchema = z.object({
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

export const createIncidentActionSchema = createIncidentBaseSchema.refine(
  (data) => data.edgeIds !== undefined || data.position !== undefined,
  { message: "At least one of 'edgeIds' or 'position' must be provided" }
);

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

// ─── Discriminated union of all actions ─────────────────────────────

export const scenarioActionSchema = z.discriminatedUnion("type", [
  spawnVehiclesActionSchema,
  createIncidentBaseSchema,
  dispatchActionSchema,
  setTrafficProfileActionSchema,
  clearIncidentsActionSchema,
  setOptionsActionSchema,
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
    { message: "At least one of 'edgeIds' or 'position' must be provided", path: ["action"] }
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

// ─── Top-level scenario schema ──────────────────────────────────────

export const scenarioSchema = scenarioMetadataSchema.extend({
  version: z.literal(1).default(1),
  variables: scenarioVariablesSchema.optional(),
  events: z.array(scenarioEventSchema),
});

// ─── Inferred TypeScript types ──────────────────────────────────────

export type SpawnVehiclesAction = z.infer<typeof spawnVehiclesActionSchema>;
export type CreateIncidentAction = z.infer<typeof createIncidentActionSchema>;
export type DispatchAction = z.infer<typeof dispatchActionSchema>;
export type SetTrafficProfileAction = z.infer<typeof setTrafficProfileActionSchema>;
export type ClearIncidentsAction = z.infer<typeof clearIncidentsActionSchema>;
export type SetOptionsAction = z.infer<typeof setOptionsActionSchema>;
export type ScenarioAction = z.infer<typeof scenarioActionSchema>;
export type ScenarioEvent = z.infer<typeof scenarioEventSchema>;
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
