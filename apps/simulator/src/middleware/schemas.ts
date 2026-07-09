import { z } from "zod";
import { HEAT_ZONE_DEFAULTS } from "../constants";

// ─── Shared primitives ──────────────────────────────────────────────

const coordinatePair = z.tuple([z.number(), z.number()]);

/**
 * A single GeoJSON position constrained to valid WGS84 ranges: longitude first
 * (-180..180), latitude second (-90..90). Rejecting out-of-range coordinates
 * (e.g. Web-Mercator metres, or swapped/garbage values) keeps a malicious or
 * malformed polygon from producing a bounding box that spans millions of
 * spatial-grid cells and freezes the event loop.
 */
const wgs84CoordinatePair = z.tuple([
  z
    .number()
    .min(-180, "longitude must be between -180 and 180")
    .max(180, "longitude must be between -180 and 180"),
  z
    .number()
    .min(-90, "latitude must be between -90 and 90")
    .max(90, "latitude must be between -90 and 90"),
]);

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
    adapterSyncInterval: z.number().positive().optional(),
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
  adapterSyncInterval: z.number().positive().optional(),
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
  .nonempty("Request body must be a non-empty array of direction requests")
  .max(100, "Maximum 100 direction requests per call");

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

// ─── Heat zones ─────────────────────────────────────────────────────

/** Counts distinct [lng, lat] positions in a ring (a duplicated closing point counts once). */
function distinctPositionCount(coords: [number, number][]): number {
  return new Set(coords.map(([lng, lat]) => `${lng},${lat}`)).size;
}

/**
 * A GeoJSON-style Polygon carrying a single flat ring of positions, matching the
 * wire `Heatzone.geometry` shape (`coordinates: Position[]`). Requires a ring with
 * at least 3 distinct points so it encloses an area.
 */
const heatzonePolygonSchema = z
  .object({
    type: z.literal("Polygon", { message: "geometry.type must be 'Polygon'" }),
    coordinates: z
      .array(wgs84CoordinatePair, {
        message: "geometry.coordinates must be an array of [lng, lat] pairs",
      })
      .min(3, "polygon ring must have at least 3 positions"),
  })
  .refine((g) => distinctPositionCount(g.coordinates) >= 3, {
    message: "polygon ring must have at least 3 distinct points",
    path: ["coordinates"],
  });

export const createHeatzoneSchema = z.object({
  geometry: heatzonePolygonSchema,
  intensity: z
    .number()
    .min(0)
    .max(1, "intensity must be a number between 0 and 1")
    .default(HEAT_ZONE_DEFAULTS.DEFAULT_INTENSITY),
});

export const updateHeatzoneSchema = z
  .object({
    geometry: heatzonePolygonSchema.optional(),
    intensity: z.number().min(0).max(1, "intensity must be a number between 0 and 1").optional(),
  })
  .refine((b) => b.geometry !== undefined || b.intensity !== undefined, {
    message: "provide at least one of 'geometry' or 'intensity'",
  });

export const seedHeatzoneSchema = z
  .object({
    count: z.number().int().positive().max(200, "count must be between 1 and 200").optional(),
  })
  .strict()
  .optional()
  .default({});

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
