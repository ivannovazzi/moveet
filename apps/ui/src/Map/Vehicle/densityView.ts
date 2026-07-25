/**
 * Shared logic for the vehicle **density (aggregation) view**.
 *
 * At the simulator's 1000+ vehicle target a city-wide view of individual
 * sprites is unreadable no matter how good the frame rate is: icons overlap,
 * headings are meaningless at 3 px, and the eye can't count. Below a zoom
 * threshold the map therefore swaps the `IconLayer` of sprites for a
 * `HexagonLayer` of binned counts.
 *
 * This module holds the parts that both sides of that swap need — the switch
 * predicate (`shouldAggregate`) and the bin geometry/colour — so
 * `VehiclesLayer` (which evaluates it inside its RAF loop) and
 * `VehicleDensityLayer` (which evaluates it on React renders) can never
 * disagree about what "density mode is engaged" means.
 */
import { resolveMapColor } from "@/lib/mapColor";

/**
 * Zoom at (and above) which individual sprites stay readable.
 *
 * Boundary is exclusive on the aggregate side: `zoom < 13` aggregates,
 * `zoom >= 13` draws sprites. z13 over Nairobi is roughly "the whole city
 * fits on screen", which is exactly where sprite overlap starts to win.
 */
export const DENSITY_ZOOM_THRESHOLD = 13;

/**
 * Fleet size below which sprites stay legible even zoomed right out, so
 * aggregating would only hide information. Inclusive: exactly this many
 * vehicles aggregates.
 */
export const DENSITY_MIN_VEHICLES = 200;

/** Target on-screen hexagon radius, in pixels, at any zoom. */
const HEX_TARGET_PX = 36;

/** Web Mercator ground resolution at zoom 0, metres per pixel (256 px tiles). */
const METERS_PER_PIXEL_AT_Z0 = 156543.03392;

/** Clamp so a degenerate/extreme zoom can't produce a useless bin size. */
const MIN_HEX_RADIUS_M = 100;
const MAX_HEX_RADIUS_M = 20000;

export interface DensitySwitchInput {
  /** The user's explicit "Density" visibility toggle. */
  enabled: boolean;
  zoom: number;
  vehicleCount: number;
}

/**
 * The single switch condition. Aggregate only when the user opted in AND the
 * view is zoomed out past the readability threshold AND there are actually
 * enough vehicles for a density plot to say something a sprite field doesn't.
 */
export function shouldAggregate({ enabled, zoom, vehicleCount }: DensitySwitchInput): boolean {
  if (!enabled) return false;
  if (!Number.isFinite(zoom)) return false;
  return zoom < DENSITY_ZOOM_THRESHOLD && vehicleCount >= DENSITY_MIN_VEHICLES;
}

/**
 * Hexagon radius in metres that keeps bins at a roughly constant on-screen
 * size as the user zooms.
 *
 * Zoom is bucketed to half-steps first: `HexagonLayer` re-runs its whole
 * binning pass whenever `radius` changes, and a continuously-varying radius
 * would re-aggregate on every wheel tick. Half-steps cap the on-screen size
 * drift at ~41 % while reducing re-aggregation to a handful of discrete jumps.
 */
export function hexRadiusMetersForZoom(zoom: number): number {
  const bucket = Math.round((Number.isFinite(zoom) ? zoom : 0) * 2) / 2;
  const metersPerPixel = METERS_PER_PIXEL_AT_Z0 / 2 ** bucket;
  const radius = Math.round(HEX_TARGET_PX * metersPerPixel);
  return Math.min(Math.max(radius, MIN_HEX_RADIUS_M), MAX_HEX_RADIUS_M);
}

export type RGBAColor = [number, number, number, number];

/** Number of steps in the sequential ramp (deck.gl's default range length). */
const RAMP_STEPS = 6;

let cachedRamp: RGBAColor[] | null = null;

/**
 * Sequential, single-hue colour ramp for bin counts, derived from the
 * `--color-overlay-density` token in `styles/tokens.css` (already the
 * project's designated "vehicle density metric" hue).
 *
 * Single hue on purpose: a rainbow or two-hue ramp reads as *categorical* or
 * *diverging*, and bin counts are neither. Low counts sit dark and mostly
 * transparent so sparse bins stay out of the way; high counts converge on the
 * full-strength token colour.
 *
 * Cached because the theme is dark-only and the token never changes at
 * runtime — and because `resolveMapColor` touches `getComputedStyle`.
 */
export function densityColorRange(): RGBAColor[] {
  if (cachedRamp) return cachedRamp;
  const [r, g, b] = resolveMapColor("var(--color-overlay-density)");
  const ramp: RGBAColor[] = [];
  for (let i = 0; i < RAMP_STEPS; i++) {
    const t = i / (RAMP_STEPS - 1);
    const scale = 0.5 + 0.5 * t; // darker at low density, full token at the top
    ramp.push([
      Math.round(r * scale),
      Math.round(g * scale),
      Math.round(b * scale),
      Math.round(70 + 165 * t),
    ]);
  }
  cachedRamp = ramp;
  return ramp;
}

/** Test seam — drops the memoized ramp so a restyled token can be re-read. */
export function resetDensityColorRange(): void {
  cachedRamp = null;
}
