import type { StartOptions } from "@/types";

/** Default start options for the simulation */
export const DEFAULT_START_OPTIONS: StartOptions = {
  minSpeed: 10,
  maxSpeed: 50,
  acceleration: 5,
  deceleration: 7,
  turnThreshold: 30,
  updateInterval: 10000,
  speedVariation: 0.1,
  heatZoneSpeedFactor: 0.5,
};

// Vehicle rendering constants (used in VehiclesLayer canvas renderer)
export const VEHICLE_RENDER = {
  /** Radius of the selection ring drawn around a selected vehicle (in shape-scale units). */
  SELECTION_RING_RADIUS: 6,
  /** Hit-test radius for click detection on vehicles (in shape-scale units). */
  HIT_TEST_RADIUS: 8,
  /** Stroke width for regular vehicle outlines. */
  STROKE_WIDTH: 0.5,
  /** Stroke width for glow effects on hovered/selected vehicles. */
  GLOW_STROKE_WIDTH: 0.8,
  /** Stroke width for the selection ring. Multiplied by shape scale. */
  SELECTION_RING_STROKE_WIDTH: 0.4,
  /** Shadow blur radius for glow on hovered vehicles. */
  HOVER_GLOW_RADIUS: 3,
  /** Shadow blur radius for glow on selected vehicles. */
  SELECTED_GLOW_RADIUS: 4,
} as const;

// Vehicle interpolation constants (smooth animation between WS updates)
export const VEHICLE_INTERPOLATION = {
  /** Fallback lerp duration (ms) before we have enough samples. */
  DEFAULT_LERP_MS: 150,
  /** Minimum lerp duration (ms) to avoid jitter from timing noise. */
  MIN_LERP_MS: 30,
  /** Allow interpolation to overshoot target by this factor to avoid pause at destination. */
  MAX_T: 1.15,
} as const;

// Heat layer contour density viewport
export const HEAT_LAYER = {
  /** Viewport width for the contour density generator. */
  VIEWPORT_WIDTH: 1300,
  /** Viewport height for the contour density generator. */
  VIEWPORT_HEIGHT: 1000,
} as const;
