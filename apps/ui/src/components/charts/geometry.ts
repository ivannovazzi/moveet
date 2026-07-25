/**
 * Pure data → geometry mapping for the analytics charts.
 *
 * Everything in here is deterministic and DOM-free so the chart maths can be
 * unit-tested directly (a known series must produce known path points) while
 * the React components stay thin wrappers that only place the geometry.
 *
 * Coordinate space is SVG user units: x grows right, y grows *down*, so the
 * y scale is inverted relative to the value domain.
 */

export interface Point {
  x: number;
  y: number;
}

/** One observation. `x` is normally an epoch-ms timestamp. */
export interface Datum {
  x: number;
  y: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The rectangle the marks are allowed to occupy, in SVG user units. */
export interface PlotBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export const DEFAULT_INSETS: Insets = { top: 4, right: 4, bottom: 4, left: 4 };

/** Round to 2dp — keeps path strings short and test assertions exact. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function plotBox(width: number, height: number, insets: Insets = DEFAULT_INSETS): PlotBox {
  return {
    x0: insets.left,
    x1: width - insets.right,
    y0: insets.top,
    y1: height - insets.bottom,
  };
}

/** Min/max of the finite values in `values`, or null when there are none. */
export function extent(values: number[]): [number, number] | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return Number.isFinite(lo) ? [lo, hi] : null;
}

/**
 * Axis ticks on clean 1/2/5×10ⁿ steps covering [min, max].
 *
 * `count` is a *target*; the returned array is whatever the nice step produces,
 * so it can be one or two ticks either side of the request. A flat series
 * (min === max) still yields a two-tick domain so the chart has a real height.
 */
export function niceTicks(min: number, max: number, count = 2): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];

  const span = max - min || Math.abs(max) || 1;
  const rawStep = span / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;

  const lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  if (hi <= lo) hi = lo + step;

  // `step` can be fractional, so re-round every tick to the step's precision
  // instead of accumulating float error across the loop.
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const ticks: number[] = [];
  const steps = Math.round((hi - lo) / step);
  for (let i = 0; i <= steps; i++) {
    ticks.push(Number((lo + i * step).toFixed(decimals + 2)));
  }
  return ticks;
}

export interface BuildSeriesOptions {
  width: number;
  height: number;
  insets?: Insets;
  /** Shared time axis. Defaults to the series' own x extent. */
  xDomain?: [number, number];
  /** Render domain for y. Defaults to the nice-tick domain over the data. */
  yDomain?: [number, number];
  /** Target tick count when `yDomain` is derived. */
  tickCount?: number;
}

export interface SeriesGeometry {
  /** Projected marks, in input order. */
  points: Point[];
  /** `M…L…` path for the 2px line. */
  line: string;
  /** Line closed down to the baseline, for the ~10% area wash. */
  area: string;
  first: Point;
  last: Point;
  xDomain: [number, number];
  yDomain: [number, number];
  /** Ticks inside `yDomain` (empty when `yDomain` was supplied explicitly). */
  yTicks: number[];
  box: PlotBox;
  /** Maps a value to a y coordinate inside `box`. */
  scaleY: (value: number) => number;
  /** Maps an x (epoch ms) to an x coordinate inside `box`. */
  scaleX: (x: number) => number;
}

/**
 * Project a series into the plot box.
 *
 * Returns null for an empty series — callers render an empty state rather than
 * blank axes. A single-point series is projected onto the right edge (the
 * "latest" position) so it does not pretend to span the axis.
 */
export function buildSeries(data: Datum[], opts: BuildSeriesOptions): SeriesGeometry | null {
  const clean = data.filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
  if (clean.length === 0) return null;

  const box = plotBox(opts.width, opts.height, opts.insets ?? DEFAULT_INSETS);

  const xValues = clean.map((d) => d.x);
  const xExtent = opts.xDomain ?? (extent(xValues) as [number, number]);
  const xSpan = xExtent[1] - xExtent[0];
  const scaleX = (x: number) =>
    xSpan === 0 ? box.x1 : box.x0 + ((x - xExtent[0]) / xSpan) * (box.x1 - box.x0);

  const yValues = clean.map((d) => d.y);
  const dataExtent = extent(yValues) as [number, number];
  const yTicks = opts.yDomain ? [] : niceTicks(dataExtent[0], dataExtent[1], opts.tickCount ?? 2);
  const yExtent: [number, number] = opts.yDomain ?? [yTicks[0], yTicks[yTicks.length - 1]];
  const ySpan = yExtent[1] - yExtent[0];
  const scaleY = (v: number) =>
    ySpan === 0 ? (box.y0 + box.y1) / 2 : box.y1 - ((v - yExtent[0]) / ySpan) * (box.y1 - box.y0);

  const points = clean.map((d) => ({ x: round2(scaleX(d.x)), y: round2(scaleY(d.y)) }));
  const line = `M${points.map((p) => `${p.x},${p.y}`).join("L")}`;
  const first = points[0];
  const last = points[points.length - 1];
  const area = `${line}L${last.x},${round2(box.y1)}L${first.x},${round2(box.y1)}Z`;

  return {
    points,
    line,
    area,
    first,
    last,
    xDomain: xExtent,
    yDomain: yExtent,
    yTicks,
    box,
    scaleY,
    scaleX,
  };
}

/**
 * Nearest sample index for a horizontal position expressed as a 0..1 fraction
 * of the plot width. Split out from the pointer handler so the snapping rule is
 * testable without a layout engine (jsdom reports zero-width rects).
 */
export function nearestIndexForFraction(count: number, fraction: number): number {
  if (count <= 0) return -1;
  if (count === 1) return 0;
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.round(clamped * (count - 1));
}

/** `HH:MM` in the viewer's locale — the shared time axis' tick format. */
export function formatTimeTick(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return "—";
  return new Date(epochMs).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** `HH:MM:SS` — used by the crosshair readout, where seconds matter. */
export function formatTimeReadout(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return "—";
  return new Date(epochMs).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Evenly thin a series down to at most `max` samples, always keeping the first
 * and last. Used on long persisted ranges so a 24h query does not push a
 * thousand path points into a 200px-wide facet.
 */
export function downsample<T>(items: T[], max: number): T[] {
  if (max < 2 || items.length <= max) return items;
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    out.push(items[Math.round(i * step)]);
  }
  return out;
}
