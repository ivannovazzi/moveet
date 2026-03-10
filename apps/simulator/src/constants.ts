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
