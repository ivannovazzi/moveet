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

/**
 * One observation. `x` is normally an epoch-ms timestamp.
 *
 * `y` is nullable on purpose: a missing reading is a **gap**, not a zero. A
 * vehicle with no derivable ETA has no ETA — zero-filling it would draw a line
 * claiming an ETA of zero, which is a lie. Gaps break the line (see
 * `buildSeries`), and non-finite numbers (`NaN`/`Infinity`) are treated the
 * same way for the same reason.
 */
export interface Datum {
  x: number;
  y: number | null;
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
  /**
   * Pin the bottom of the value axis where a natural bound exists (speed
   * starts at 0). Without it a vehicle holding a steady 60 km/h auto-scales to
   * a flat line indistinguishable from one idling.
   */
  yFloor?: number;
  /** Pin the top of the value axis. Same idea as `yFloor`, other end. */
  yCeiling?: number;
}

/** One unbroken stretch of readings — the geometry between two gaps. */
export interface SeriesRun {
  /** Projected marks in this run, in input order. */
  points: Point[];
  /** `M…L…` subpath for this run alone. */
  line: string;
  /** This run closed down to the baseline, for the area wash. */
  area: string;
}

export interface SeriesGeometry {
  /** Projected marks, in input order, gaps omitted. */
  points: Point[];
  /** One entry per unbroken stretch of readings. A gapless series has one. */
  runs: SeriesRun[];
  /** `M…L…` path for the 2px line — one `M` subpath per run, so gaps break it. */
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

/** A row whose reading is drawable. */
function isReading(d: Datum): d is { x: number; y: number } {
  return d.y != null && Number.isFinite(d.y);
}

/**
 * Project a series into the plot box.
 *
 * Returns null when nothing is drawable — callers render an empty state rather
 * than blank axes. A single-point series is projected onto the right edge (the
 * "latest" position) so it does not pretend to span the axis.
 *
 * **Gaps.** A row with a null (or non-finite) `y` keeps its slot on the x axis
 * but carries no mark: the line is split into `runs` there, and `line` joins
 * those runs as separate `M` subpaths so the stroke *breaks* instead of
 * interpolating straight through the missing stretch. Anything built on this
 * geometry gets that for free — it is not the sparkline's private behaviour.
 */
export function buildSeries(data: Datum[], opts: BuildSeriesOptions): SeriesGeometry | null {
  // Gap rows are kept: they hold their place on the time axis, so the samples
  // either side of a gap stay where they belong instead of closing up.
  const rows = data.filter((d) => Number.isFinite(d.x));
  const readings = rows.filter(isReading);
  if (readings.length === 0) return null;

  const box = plotBox(opts.width, opts.height, opts.insets ?? DEFAULT_INSETS);

  const xExtent = opts.xDomain ?? (extent(rows.map((d) => d.x)) as [number, number]);
  const xSpan = xExtent[1] - xExtent[0];
  const scaleX = (x: number) =>
    xSpan === 0 ? box.x1 : box.x0 + ((x - xExtent[0]) / xSpan) * (box.x1 - box.x0);

  const dataExtent = extent(readings.map((d) => d.y)) as [number, number];
  // A pin is an explicit statement about the axis, so it wins over nice ticks:
  // pinning speed at 0 must put 0 on the baseline, not at the nearest round
  // number below it. The unpinned path is untouched.
  const pinned = opts.yFloor != null || opts.yCeiling != null;
  let yTicks: number[] = [];
  let yExtent: [number, number];
  if (opts.yDomain) {
    yExtent = opts.yDomain;
  } else if (pinned) {
    const lo = opts.yFloor ?? dataExtent[0];
    const hi = opts.yCeiling ?? dataExtent[1];
    yExtent = [lo, hi > lo ? hi : lo + 1];
  } else {
    yTicks = niceTicks(dataExtent[0], dataExtent[1], opts.tickCount ?? 2);
    yExtent = [yTicks[0], yTicks[yTicks.length - 1]];
  }
  const ySpan = yExtent[1] - yExtent[0];
  const scaleY = (v: number) => {
    if (ySpan === 0) return (box.y0 + box.y1) / 2;
    // A pinned axis is a hard bound, so a stray reading past it is clamped to
    // the edge rather than drawn outside the box.
    const value = pinned ? Math.min(yExtent[1], Math.max(yExtent[0], v)) : v;
    return box.y1 - ((value - yExtent[0]) / ySpan) * (box.y1 - box.y0);
  };

  const baseline = round2(box.y1);
  const points: Point[] = [];
  const runs: SeriesRun[] = [];
  let current: Point[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const line = `M${current.map((p) => `${p.x},${p.y}`).join("L")}`;
    const first = current[0];
    const last = current[current.length - 1];
    runs.push({
      points: current,
      line,
      area: `${line}L${last.x},${baseline}L${first.x},${baseline}Z`,
    });
    current = [];
  };
  for (const d of rows) {
    if (!isReading(d)) {
      flush();
      continue;
    }
    const point = { x: round2(scaleX(d.x)), y: round2(scaleY(d.y)) };
    current.push(point);
    points.push(point);
  }
  flush();

  return {
    points,
    runs,
    line: runs.map((run) => run.line).join(""),
    area: runs.map((run) => run.area).join(""),
    first: points[0],
    last: points[points.length - 1],
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
