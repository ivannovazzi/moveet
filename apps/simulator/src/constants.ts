/**
 * Application-wide constants and configuration values
 */

// Time intervals (in milliseconds)
export const TIME_INTERVALS = {
  /** Auto heat zone regeneration interval (5 minutes) */
  HEAT_ZONE_REGEN_INTERVAL: 5 * 60 * 1000,
} as const;

// Heat zone generation defaults
export const HEAT_ZONE_DEFAULTS = {
  /** Default number of heat zones to generate */
  COUNT: 10,
  /** Minimum radius for heat zones (in km) */
  MIN_RADIUS: 0.2,
  /** Maximum radius for heat zones (in km) */
  MAX_RADIUS: 0.5,
  /** Minimum intensity for heat zones (0-1) */
  MIN_INTENSITY: 0.3,
  /** Maximum intensity for heat zones (1-1) */
  MAX_INTENSITY: 1,
} as const;

// Vehicle state management
export const VEHICLE_CONSTANTS = {
  /** Maximum number of visited edges to track per vehicle before clearing */
  MAX_VISITED_EDGES: 1000,
} as const;

// WebSocket broadcaster tuning
export const WS_BROADCASTER = {
  /** Backpressure threshold in bytes. Clients with bufferedAmount above this are skipped. */
  BACKPRESSURE_THRESHOLD: 64 * 1024, // 64 KB
  /** Number of consecutive skipped flushes before a slow client is disconnected. */
  MAX_DROPPED_FLUSHES: 50,
  /** Minimum position change (in degrees) to trigger a delta update for a vehicle. ~1.1 meters. */
  POSITION_DELTA_THRESHOLD: 0.00001,
  /** Default flush interval in milliseconds. */
  DEFAULT_FLUSH_INTERVAL_MS: 100,
} as const;

// Spatial grid shared between HeatZoneManager and RoadNetwork
export const SPATIAL_GRID = {
  /** Grid cell size in degrees (~500 m). Used for spatial indexing in both HeatZoneManager and RoadNetwork. */
  CELL_SIZE: 0.005,
} as const;

// Fleet color palette (10 distinct colors for fleet grouping)
export const FLEET_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#a855f7", // purple
  "#ec4899", // pink
  "#78716c", // stone
] as const;
