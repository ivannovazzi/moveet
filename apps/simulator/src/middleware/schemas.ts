import { z } from "zod";

// ─── Shared primitives ──────────────────────────────────────────────

const coordinatePair = z.tuple([z.number(), z.number()]);

export const incidentTypeEnum = z.enum(["accident", "closure", "construction"], {
  message: "type must be one of: accident, closure, construction",
});

// ─── Simulation control ─────────────────────────────────────────────

export const startSchema = z
  .object({
    minSpeed: z.number().optional(),
    maxSpeed: z.number().optional(),
    speedVariation: z.number().min(0).max(1).optional(),
    acceleration: z.number().optional(),
    deceleration: z.number().optional(),
    turnThreshold: z.number().optional(),
    heatZoneSpeedFactor: z.number().min(0).max(1).optional(),
    updateInterval: z.number().positive().optional(),
    vehicleTypes: z.record(z.string(), z.number().int().nonnegative()).optional(),
  })
  .strict()
  .optional()
  .default({});

export const optionsSchema = z.object({
  minSpeed: z.number(),
  maxSpeed: z.number(),
  speedVariation: z.number().min(0).max(1),
  acceleration: z.number(),
  deceleration: z.number(),
  turnThreshold: z.number(),
  heatZoneSpeedFactor: z.number().min(0).max(1),
  updateInterval: z.number().positive(),
});

// ─── Direction / waypoints ──────────────────────────────────────────

export const waypointRequestSchema = z.object({
  lat: z.number({ message: "'lat' must be a valid number" }),
  lng: z.number({ message: "'lng' must be a valid number" }),
  dwellTime: z.number().positive().optional(),
  label: z.string().optional(),
});

const directionItemSchema = z.object({
  id: z.string().min(1, "'id' must be a non-empty string"),
  lat: z.number().optional(),
  lng: z.number().optional(),
  waypoints: z.array(waypointRequestSchema).optional(),
});

export const directionSchema = z
  .array(directionItemSchema)
  .nonempty("Request body must be a non-empty array of direction requests");

// ─── Find node / find road ──────────────────────────────────────────

export const coordinatesSchema = coordinatePair;

// ─── Search ─────────────────────────────────────────────────────────

export const searchSchema = z.object({
  query: z.string().min(1, "'query' must be a non-empty string"),
});

// ─── Incidents ──────────────────────────────────────────────────────

export const createIncidentSchema = z.object({
  edgeIds: z.array(z.string()).nonempty("edgeIds must be a non-empty array of strings"),
  type: incidentTypeEnum,
  duration: z
    .number({ message: "duration must be a positive number" })
    .positive("duration must be a positive number"),
  severity: z.number().min(0).max(1, "severity must be a number between 0 and 1").optional(),
});

export const incidentAtPositionSchema = z.object({
  lat: z.number({ message: "lat and lng are required numbers" }),
  lng: z.number({ message: "lat and lng are required numbers" }),
  type: incidentTypeEnum,
});

// ─── Replay ─────────────────────────────────────────────────────────

export const replayStartSchema = z.object({
  file: z.string({ message: "file is required" }).min(1, "file is required"),
  speed: z.number().positive().optional(),
});

export const replaySeekSchema = z.object({
  timestamp: z.number({ message: "timestamp is required" }),
});

export const replaySpeedSchema = z.object({
  speed: z.number().positive().optional(),
});

// ─── Clock ──────────────────────────────────────────────────────────

export const clockSchema = z
  .object({
    speedMultiplier: z.number().min(0, "speedMultiplier must be a non-negative number").optional(),
    setTime: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.setTime !== undefined) {
        const t = new Date(data.setTime);
        return !isNaN(t.getTime());
      }
      return true;
    },
    { message: "setTime must be a valid ISO date string", path: ["setTime"] }
  );

// ─── Traffic profile ────────────────────────────────────────────────

export const trafficProfileSchema = z.object({
  name: z.string({ message: "name is required" }),
  timeRanges: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      demandMultiplier: z.number(),
      affectedHighways: z.array(z.string()),
    })
  ),
});

// ─── Fleets ─────────────────────────────────────────────────────────

export const createFleetSchema = z.object({
  name: z.string({ message: "name is required" }).min(1, "name is required"),
  source: z.enum(["local", "external"]).optional(),
});

export const fleetAssignSchema = z.object({
  vehicleIds: z.array(z.string(), {
    message: "vehicleIds array is required",
  }),
});
