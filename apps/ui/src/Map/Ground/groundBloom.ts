/**
 * The ground bloom: the soft lit area under the map.
 *
 * The ground used to be lit by a CSS radial gradient centred at 50%/38% of the
 * viewport, so the "city" was wherever the window happened to be pointing. Here
 * the lit area is rasterised from the road network's own vertex density and
 * handed to a geo-anchored `BitmapLayer`, so what glows *is* the city and it
 * travels with the map.
 *
 * The field is built once per network load. It is a small grid (a few hundred
 * KB of floats) blurred with separable box passes — the same trick a gaussian
 * blur uses — then painted to a canvas that deck.gl samples with linear
 * filtering. Nothing here runs per frame.
 */
import type { GeoBounds } from "./hexLattice";

/** Field resolution per axis. Small on purpose: the result is a soft wash. */
export const FIELD_SIZE = 160;

/** Blur radius in cells. Wide enough that individual streets never show. */
const BLUR_CELLS = 11;

/** How many blur passes. Three box passes approximate a gaussian closely. */
const BLUR_PASSES = 3;

/**
 * Fraction of the network's span added as margin on every side, so the bloom
 * has room to fall to zero before the bitmap's edge. A visible rectangle edge
 * would give the whole thing away.
 */
const BOUNDS_PADDING = 0.18;

/** Peak alpha of the bloom, 0-255. The lift token does the rest. */
const PEAK_ALPHA = 205;

/**
 * Pulls the midtones up. Raw density is extremely long-tailed — a couple of
 * junctions carry hundreds of vertices and everything else rounds to nothing —
 * so without this the bloom is a few hot dots on a dead field.
 */
const DENSITY_GAMMA = 0.55;

/** Pad a bounding box outward by {@link BOUNDS_PADDING} of its own span. */
export function padBounds(bounds: GeoBounds, padding = BOUNDS_PADDING): GeoBounds {
  const [[west, south], [east, north]] = bounds;
  const padX = (east - west) * padding;
  const padY = (north - south) * padding;
  return [
    [west - padX, south - padY],
    [east + padX, north + padY],
  ];
}

/**
 * Bin `points` ([lng, lat]) into a `size x size` grid over `bounds`.
 *
 * Returns raw counts — normalisation happens after the blur, because blurring
 * a normalised field and normalising a blurred one give different peaks and
 * only the latter reaches 1.
 */
export function rasterizeDensity(
  points: Iterable<readonly [number, number]>,
  bounds: GeoBounds,
  size = FIELD_SIZE
): Float32Array {
  const field = new Float32Array(size * size);
  const [[west, south], [east, north]] = bounds;
  const spanX = east - west;
  const spanY = north - south;
  if (!(spanX > 0) || !(spanY > 0)) return field;

  for (const [lng, lat] of points) {
    const x = Math.floor(((lng - west) / spanX) * size);
    const y = Math.floor(((lat - south) / spanY) * size);
    if (x < 0 || y < 0 || x >= size || y >= size) continue;
    field[y * size + x] += 1;
  }
  return field;
}

/** One separable box-blur pass, in place across a scratch buffer. */
function boxBlurPass(src: Float32Array, dst: Float32Array, size: number, radius: number): void {
  const window = radius * 2 + 1;
  // Horizontal.
  for (let y = 0; y < size; y++) {
    const row = y * size;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) {
      sum += src[row + Math.min(size - 1, Math.max(0, x))];
    }
    for (let x = 0; x < size; x++) {
      dst[row + x] = sum / window;
      const out = Math.min(size - 1, Math.max(0, x - radius));
      const into = Math.min(size - 1, Math.max(0, x + radius + 1));
      sum += src[row + into] - src[row + out];
    }
  }
  // Vertical, back into src.
  for (let x = 0; x < size; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      sum += dst[Math.min(size - 1, Math.max(0, y)) * size + x];
    }
    for (let y = 0; y < size; y++) {
      src[y * size + x] = sum / window;
      const out = Math.min(size - 1, Math.max(0, y - radius));
      const into = Math.min(size - 1, Math.max(0, y + radius + 1));
      sum += dst[into * size + x] - dst[out * size + x];
    }
  }
}

/**
 * Blur, normalise to 0..1, gamma-lift, and force the outermost ring to zero so
 * the bitmap's own edge can never show as a seam.
 */
export function smoothField(field: Float32Array, size = FIELD_SIZE): Float32Array {
  const work = Float32Array.from(field);
  const scratch = new Float32Array(work.length);
  for (let pass = 0; pass < BLUR_PASSES; pass++) {
    boxBlurPass(work, scratch, size, BLUR_CELLS);
  }

  let max = 0;
  for (const v of work) if (v > max) max = v;
  if (max <= 0) return work;

  // Cosine falloff over the outer 10% of cells: a hard cut would read as a
  // rectangle edge just as clearly as no falloff at all.
  const edge = Math.max(1, Math.round(size * 0.1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inset = Math.min(x, y, size - 1 - x, size - 1 - y);
      const mask = inset >= edge ? 1 : 0.5 - 0.5 * Math.cos((inset / edge) * Math.PI);
      const i = y * size + x;
      work[i] = (work[i] / max) ** DENSITY_GAMMA * mask;
    }
  }
  return work;
}

/** A colour as bytes, 0-255. Extra channels past `b` are ignored, so the
 * `[r, g, b, a]` arrays `resolveMapColor` returns can be passed straight in. */
export type Rgb = readonly number[];

/**
 * Paint a smoothed field as RGBA bytes: one tint, rising alpha, with the peak
 * pulled a little toward `core`. The chroma shift is what keeps the centre from
 * reading as "the same grey, brighter".
 */
export function fieldToRgba(
  field: Float32Array,
  lift: Rgb,
  core: Rgb,
  size = FIELD_SIZE
): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(new ArrayBuffer(size * size * 4));
  for (let y = 0; y < size; y++) {
    // Canvas rows run top-down; the field's rows run south-to-north.
    const srcRow = (size - 1 - y) * size;
    for (let x = 0; x < size; x++) {
      const v = field[srcRow + x];
      const mix = v * v; // only the brightest part of the field takes the tint
      const i = (y * size + x) * 4;
      pixels[i] = lift[0] + (core[0] - lift[0]) * mix;
      pixels[i + 1] = lift[1] + (core[1] - lift[1]) * mix;
      pixels[i + 2] = lift[2] + (core[2] - lift[2]) * mix;
      pixels[i + 3] = v * PEAK_ALPHA;
    }
  }
  return pixels;
}

/**
 * Upscale the RGBA field and hand it back as a PNG data URL for `BitmapLayer`.
 *
 * A data URL rather than the canvas element itself: deck.gl's image loading
 * path is the reliable one for both, and this repo has already been bitten once
 * by handing a layer something loaders.gl would not decode.
 *
 * Returns null where there is no 2D canvas (jsdom), which the layer treats as
 * "no bloom" rather than as an error — the pure functions above are what the
 * tests assert on.
 */
export function bloomImage(
  pixels: Uint8ClampedArray<ArrayBuffer>,
  size = FIELD_SIZE,
  scale = 3
): string | null {
  if (typeof document === "undefined") return null;

  const small = document.createElement("canvas");
  small.width = size;
  small.height = size;
  const smallCtx = small.getContext("2d");
  if (!smallCtx) return null;
  smallCtx.putImageData(new ImageData(pixels, size, size), 0, 0);

  const out = document.createElement("canvas");
  out.width = size * scale;
  out.height = size * scale;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}
