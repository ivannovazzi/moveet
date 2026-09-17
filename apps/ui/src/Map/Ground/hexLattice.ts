/**
 * The map's ground pattern: a honeycomb lattice in geographic coordinates.
 *
 * It replaced a square lat/lon graticule, which had two problems on a road
 * network. It was CSS behind the (transparent) deck.gl canvas, so it was nailed
 * to the screen while everything drawn on it moved; and axis-aligned hairlines
 * run parallel to a street grid, so over a city like Manhattan the ground kept
 * trying to look like more roads. A honeycomb has no axis-aligned edge at all.
 *
 * The lattice carries no coordinate meaning — it is texture, not a reading aid
 * — which is what lets everything below take liberties a graticule could not:
 * sizes are powers of two rather than round degrees, and the cells are squashed
 * in latitude so they come out regular on screen.
 *
 * Nothing here touches React or deck.gl. It is arithmetic on degrees, which is
 * what makes the LOD ladder and the geometry testable.
 */

/** `[[west, south], [east, north]]` — the shape deck.gl's viewport reports. */
export type GeoBounds = [[number, number], [number, number]];

/** deck.gl's Web Mercator world spans 360° across 512 px at zoom 0. */
const WORLD_SIZE_PX = 512;

/** Degrees of longitude per screen pixel at a given deck.gl zoom. */
export function degreesPerPixel(zoom: number): number {
  return 360 / (WORLD_SIZE_PX * 2 ** zoom);
}

/** Roughly how wide a cell should sit on screen, in px, corner to corner. */
const TARGET_WIDTH_PX = 92;

const SQRT3 = Math.sqrt(3);

/**
 * Half-width of the zone, in rungs, where two lattices are drawn at once.
 *
 * Hex lattices do not nest: halving the cell size gives a lattice that shares
 * nothing with the one before it, so there is no equivalent of a square grid's
 * "add the half-step lines" that could make a step invisible. The step is
 * therefore a crossfade, and this is how much of each rung it occupies. Small,
 * so most of the time exactly one lattice is on screen.
 */
const CROSSFADE = 0.18;

export interface HexLod {
  /** Cell circumradius in degrees of longitude, for the dominant lattice. */
  primary: number;
  /** The neighbouring rung, present only while crossfading. */
  secondary: number | null;
  /**
   * 0..0.5 — the secondary lattice's share. It rises to 0.5 at the rung
   * boundary, where the two swap roles and it falls back, so neither layer's
   * opacity ever jumps.
   */
  mix: number;
}

/**
 * Pick the cell size (or the two being crossfaded) for a zoom level.
 *
 * Sizes are powers of two in degrees. A round-number ladder buys nothing here:
 * nobody reads a coordinate off a honeycomb, and exact halving is what keeps
 * the crossfade symmetric.
 */
export function hexLod(zoom: number): HexLod {
  const safeZoom = Number.isFinite(zoom) ? zoom : 12;
  const idealSize = (degreesPerPixel(safeZoom) * TARGET_WIDTH_PX) / SQRT3;

  const exact = Math.log2(idealSize);
  const nearest = Math.round(exact);
  const primary = 2 ** nearest;

  // Distance to the rung boundary, in rungs: ±0.5 is where the ladder hands over.
  const offset = exact - nearest;
  const intoFade = Math.abs(offset) - (0.5 - CROSSFADE);
  if (intoFade <= 0) return { primary, secondary: null, mix: 0 };

  return {
    primary,
    secondary: 2 ** (nearest + Math.sign(offset)),
    mix: Math.min(0.5, (intoFade / CROSSFADE) * 0.5),
  };
}

/**
 * Grow bounds outward to whole multiples of `size * cells`.
 *
 * Panning changes the viewport bounds every animation frame. Building the
 * lattice straight off them would hand deck.gl a new `data` array 60x a second;
 * snapped bounds only change when the view crosses a whole block, so a pan
 * rebuilds it a handful of times. The cost is a few cells built off each edge,
 * which is why the block is small.
 */
export function snapBounds(bounds: GeoBounds, size: number, cells = 6): GeoBounds {
  const block = size * cells;
  const [[west, south], [east, north]] = bounds;
  return [
    [Math.floor(west / block) * block, Math.floor(south / block) * block],
    [Math.ceil(east / block) * block, Math.ceil(north / block) * block],
  ];
}

/** Steps the latitude squash is quantized to. */
const SQUASH_STEP = 0.02;

/**
 * How much to compress the lattice in latitude so its cells come out regular.
 *
 * A degree of latitude covers more screen than a degree of longitude by
 * `1 / cos(latitude)` in Web Mercator. Near the equator that is nothing, but at
 * Manhattan's latitude an un-squashed lattice is a third taller than it is
 * wide, which reads as a stretched honeycomb rather than a honeycomb.
 *
 * Quantized, because the value feeds the lattice's absolute anchoring: letting
 * it vary continuously would slide every row a little as you panned north.
 */
export function latitudeSquash(latitude: number): number {
  const safe = Number.isFinite(latitude) ? Math.min(85, Math.max(-85, latitude)) : 0;
  const cos = Math.cos((safe * Math.PI) / 180);
  return Math.max(SQUASH_STEP, Math.round(cos / SQUASH_STEP) * SQUASH_STEP);
}

/** A lattice stroke as a deck.gl path, in `[lng, lat]`. */
export type HexPath = [number, number][];

/**
 * Guard against a caller asking for a size the LOD ladder would never pick.
 * The ladder keeps the real counts near (viewport / 132px) + a block.
 */
const MAX_ROWS = 256;
const MAX_COLS = 256;

/**
 * Build the honeycomb covering `bounds`.
 *
 * Pointy-top cells, anchored at (0, 0) so the lattice is a property of the
 * world and not of wherever the camera happens to be. It comes back as one
 * zigzag polyline per row plus the short vertical struts between rows — the
 * decomposition that draws every edge exactly once. Emitting six edges per cell
 * instead would paint every shared edge twice, and at these alphas a
 * double-painted edge is a visibly brighter one.
 */
export function hexLatticePaths(bounds: GeoBounds, size: number, squash: number): HexPath[] {
  if (!(size > 0) || !(squash > 0)) return [];
  const [[west, south], [east, north]] = bounds;

  const halfWidth = (SQRT3 * size) / 2; // apex to flank, in longitude
  const width = SQRT3 * size; // cell width, and the spacing within a row
  const rowPitch = 1.5 * size * squash; // centre to centre, in latitude
  const apex = size * squash; // centre to top vertex
  const flank = (size / 2) * squash; // centre to upper-flank vertex

  const firstRow = Math.floor((south - apex) / rowPitch);
  const lastRow = Math.ceil((north + apex) / rowPitch);
  if (lastRow - firstRow > MAX_ROWS) return [];
  if ((east - west) / halfWidth > MAX_COLS * 2) return [];

  const paths: HexPath[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    const centreY = row * rowPitch;
    // Odd rows are offset by half a cell — that offset is the honeycomb.
    const offsetX = row % 2 === 0 ? 0 : halfWidth;

    // The row's upper boundary: a zigzag whose vertices alternate between the
    // cell apex and its flank, one half-width apart.
    const firstStep = Math.floor((west - offsetX) / halfWidth) - 1;
    const lastStep = Math.ceil((east - offsetX) / halfWidth) + 1;
    const zigzag: HexPath = [];
    for (let step = firstStep; step <= lastStep; step++) {
      // Multiply out from the step index rather than accumulating: at street
      // zoom the sizes are small enough for `+=` drift to visibly bend a row.
      zigzag.push([offsetX + step * halfWidth, centreY + (step % 2 === 0 ? apex : flank)]);
    }
    paths.push(zigzag);

    // One vertical strut per cell, on the flank the cell shares with its
    // neighbour in the same row.
    const firstCell = Math.floor((west - offsetX) / width) - 1;
    const lastCell = Math.ceil((east - offsetX) / width) + 1;
    for (let cell = firstCell; cell <= lastCell; cell++) {
      const x = offsetX + cell * width + halfWidth;
      paths.push([
        [x, centreY + flank],
        [x, centreY - flank],
      ]);
    }
  }
  return paths;
}
