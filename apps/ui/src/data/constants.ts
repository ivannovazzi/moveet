import type { StartOptions } from "@/types";

/** Default start options for the simulation */
export const DEFAULT_START_OPTIONS: StartOptions = {
  minSpeed: 10,
  maxSpeed: 50,
  acceleration: 5,
  deceleration: 7,
  turnThreshold: 30,
  // Matches the simulator's UPDATE_INTERVAL default (500ms) and stays within
  // the SpeedPanel slider range [50, 2000]. The previous 10000ms was both
  // out of slider range and, if posted before getOptions() resolves, drove a
  // 10s server tick — exceeding the client's MAX_CONTINUOUS_GAP_MS so vehicles
  // teleported between updates instead of interpolating smoothly.
  updateInterval: 500,
  adapterSyncInterval: 1000,
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
  /**
   * A position delta is treated as a teleport (and snapped, not animated) when
   * it exceeds `speed × elapsed × TELEPORT_FACTOR + TELEPORT_MIN_FLOOR_M` meters.
   * Catches bulk reset, WS reconnect resync, and dispatch-driven repositioning
   * without needing an explicit lifecycle signal.
   */
  TELEPORT_FACTOR: 3,
  /** Minimum teleport threshold — ensures stopped vehicles (speed≈0) still accept
   *  small real-world repositions without snapping. */
  TELEPORT_MIN_FLOOR_M: 50,
  /**
   * Absolute ceiling (ms) on the gap between consecutive position updates for a
   * vehicle. Beyond this the continuity assumption is broken — the rAF loop was
   * starved (backgrounded tab, sleep/wake, long GC stall, resync), so the stored
   * position is stale and we snap to the truth instead of animating a fly-across.
   * Independent of speed/distance: the distance-scaled teleport envelope grows
   * with elapsed and therefore can't catch a long idle gap on its own. Set above
   * the max supported update interval (2000 ms) so a normal slow tick still
   * animates; this also implicitly bounds the EMA lerp duration, since any larger
   * gap snaps (and resets lerpMs) rather than feeding the EMA.
   */
  MAX_CONTINUOUS_GAP_MS: 2500,
} as const;

/**
 * Decide whether a position update should snap (jump) rather than animate.
 * Snap when the vehicle is brand-new, when the update follows a continuity gap
 * (stale frame after a starved rAF loop), or when the delta exceeds what plausible
 * continuous motion could produce in the elapsed time (teleport / reposition).
 */
export function shouldSnapPosition(params: {
  isNew: boolean;
  elapsedMs: number;
  distanceM: number;
  speedMps: number;
}): boolean {
  const { isNew, elapsedMs, distanceM, speedMps } = params;
  if (isNew) return true;
  if (elapsedMs > VEHICLE_INTERPOLATION.MAX_CONTINUOUS_GAP_MS) return true;
  const maxPlausibleM =
    speedMps * (elapsedMs / 1000) * VEHICLE_INTERPOLATION.TELEPORT_FACTOR +
    VEHICLE_INTERPOLATION.TELEPORT_MIN_FLOOR_M;
  return distanceM > maxPlausibleM;
}

// Heat layer contour density viewport
export const HEAT_LAYER = {
  /** Viewport width for the contour density generator. */
  VIEWPORT_WIDTH: 1300,
  /** Viewport height for the contour density generator. */
  VIEWPORT_HEIGHT: 1000,
} as const;
