/**
 * The map's graticule: the lat/lon grid the ground is drawn on.
 *
 * It used to be a 160px SVG tile repeated behind the (transparent) deck.gl
 * canvas, which meant the grid was nailed to the screen: roads and vehicles
 * slid across it and the ground itself never moved. Everything here is in
 * degrees so the grid can be handed to a deck.gl layer and pan/zoom with the
 * map like any other geography.
 *
 * Nothing in this module touches React or deck.gl — it is arithmetic on
 * degrees, which is what makes the LOD ladder testable.
 */

/**
 * Grid steps in degrees, coarse → fine: the 1-2-5 ladder every map scale bar
 * uses, so the numbers a reader infers from the grid stay round at any zoom.
 */
export const GRATICULE_STEPS: readonly number[] = [
  5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001, 0.0005, 0.0002, 0.0001,
];

/** Roughly how far apart the solid grid lines should sit on screen, in px. */
const TARGET_SPACING_PX = 132;

/** deck.gl's Web Mercator world spans 360° across 512 px at zoom 0. */
const WORLD_SIZE_PX = 512;

/** Degrees of longitude per screen pixel at a given deck.gl zoom. */
export function degreesPerPixel(zoom: number): number {
  return 360 / (WORLD_SIZE_PX * 2 ** zoom);
}

export interface GraticuleLod {
  /** Spacing of the solid grid, in degrees. */
  coarse: number;
  /** The half-step grid drawn between the solid lines, in degrees. */
  fine: number;
  /**
   * 0..1 — how far the half-step grid has faded in. It reaches 1 just before
   * the ladder snaps a rung finer, so new detail arrives as a fade and the
   * snap itself swaps two grids that already look the same.
   */
  fineFade: number;
}

/**
 * Pick the grid step for a zoom level, plus the fade of the half-step tier.
 *
 * The rung is the one whose on-screen spacing is closest to
 * {@link TARGET_SPACING_PX} in log space, so the grid never gets more than
 * about 1.6x too wide or 1.6x too tight before the ladder moves.
 */
export function graticuleLod(zoom: number): GraticuleLod {
  const ideal = degreesPerPixel(Number.isFinite(zoom) ? zoom : 12) * TARGET_SPACING_PX;

  let coarse = GRATICULE_STEPS[0];
  let bestError = Infinity;
  for (const step of GRATICULE_STEPS) {
    const error = Math.abs(Math.log(step / ideal));
    if (error < bestError) {
      bestError = error;
      coarse = step;
    }
  }

  // > 1 means the solid lines have drifted wider than the target spacing, i.e.
  // the view is zoomed into the upper half of this rung and there is room for
  // the half-step tier. Full strength by 1.5x, which is about where the ladder
  // hands over to the next rung down.
  const ratio = coarse / ideal;
  const fineFade = Math.min(1, Math.max(0, (ratio - 1) / 0.5));

  return { coarse, fine: coarse / 2, fineFade };
}

/** `[[west, south], [east, north]]` — the shape deck.gl's viewport reports. */
export type GeoBounds = [[number, number], [number, number]];

/**
 * Grow bounds outward to whole multiples of `step * cells`.
 *
 * Panning changes the viewport bounds every animation frame. Building the grid
 * straight off them would hand deck.gl a new `data` array 60x a second; snapped
 * bounds only change once the view crosses a whole block, so a pan rebuilds the
 * grid a handful of times instead of continuously. The cost is drawing up to
 * `cells` extra lines off each edge, which is why the block is small.
 */
export function snapBounds(bounds: GeoBounds, step: number, cells = 8): GeoBounds {
  const block = step * cells;
  const [[west, south], [east, north]] = bounds;
  return [
    [Math.floor(west / block) * block, Math.floor(south / block) * block],
    [Math.ceil(east / block) * block, Math.ceil(north / block) * block],
  ];
}

/**
 * Hard cap on lines per axis. The LOD ladder keeps the real count near
 * (viewport / 132px) + 2 blocks, so this only ever fires if a caller asks for a
 * step the ladder would never choose — in which case drawing nothing beats
 * locking the frame building tens of thousands of paths.
 */
const MAX_LINES_PER_AXIS = 512;

/** Slack, in whole steps, for coordinates that land on a step boundary. */
const BOUNDARY_EPS = 1e-9;

/** A grid line as a deck.gl path: two points, in `[lng, lat]`. */
export type GraticulePath = [[number, number], [number, number]];

/**
 * Build the meridians and parallels covering `bounds` at `step` degrees.
 *
 * Both axes use the same step in degrees rather than a step corrected for
 * `cos(latitude)`. Near the equator, where the simulated networks sit, the
 * cells are square to well under a percent; far north or south they lean tall.
 * The alternative is latitudes that aren't round numbers, which costs the grid
 * the one thing it is for.
 */
export function graticulePaths(bounds: GeoBounds, step: number, skipStep = 0): GraticulePath[] {
  const [[west, south], [east, north]] = bounds;
  if (!(step > 0)) return [];

  // The half-step tier is drawn with `skipStep` set to the coarse step so its
  // lines land strictly *between* the solid ones. Without it every coarse line
  // would be painted twice and read brighter than the grid it belongs to.
  const onSkipped = (value: number) =>
    skipStep > 0 && Math.abs(value / skipStep - Math.round(value / skipStep)) < 1e-6;

  // `36.0 / 0.1` is 360.00000000000006, so a bare ceil()/floor() drops the
  // line sitting exactly on the boundary — and the snapped bounds the caller
  // passes in put a line on the boundary every single time.
  const firstLng = Math.ceil(west / step - BOUNDARY_EPS) * step;
  const firstLat = Math.ceil(south / step - BOUNDARY_EPS) * step;
  const lngCount = Math.floor((east - firstLng) / step + BOUNDARY_EPS) + 1;
  const latCount = Math.floor((north - firstLat) / step + BOUNDARY_EPS) + 1;
  if (lngCount > MAX_LINES_PER_AXIS || latCount > MAX_LINES_PER_AXIS) return [];

  const paths: GraticulePath[] = [];
  for (let i = 0; i < lngCount; i++) {
    // Multiply out from the first line rather than accumulating `+= step`:
    // steps like 0.0002 accumulate float drift fast enough to visibly bend a
    // grid at street zoom.
    const lng = firstLng + i * step;
    if (onSkipped(lng)) continue;
    paths.push([
      [lng, south],
      [lng, north],
    ]);
  }
  for (let i = 0; i < latCount; i++) {
    const lat = firstLat + i * step;
    if (onSkipped(lat)) continue;
    paths.push([
      [west, lat],
      [east, lat],
    ]);
  }
  return paths;
}
