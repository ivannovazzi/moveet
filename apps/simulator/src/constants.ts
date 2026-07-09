/**
 * Application-wide constants and configuration values
 */

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
  /**
   * Default intensity applied to a manually created zone (POST /heatzones) when
   * the caller supplies none. Single server-side source of truth so the schema
   * default and the route fall back to the same value.
   */
  DEFAULT_INTENSITY: 0.6,
  /**
   * Hard cap on the total number of heat zones held at once. Seeding/generation
   * appends only up to this cap (no error); a single create at the cap is
   * rejected. Keeps the zone list + spatial grid bounded so repeated seeding
   * cannot degrade rendering and point-in-polygon checks.
   */
  MAX_TOTAL: 100,
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
  /**
   * Defense-in-depth cap on how many grid cells a single zone's bounding box may
   * span before it is refused indexing. A pathological polygon (e.g. coordinates
   * in the wrong projection that bypass schema validation) could otherwise span
   * tens of millions of cells and freeze the event loop. 250k cells is ~250 km
   * square, far larger than any realistic heat zone.
   */
  MAX_ZONE_CELLS: 250_000,
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
