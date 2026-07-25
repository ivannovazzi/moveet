import { useId, useMemo } from "react";
import { cn } from "@/lib/utils";

/**
 * A micro trend chart for the inspector's telemetry section.
 *
 * Deliberately dependency-free and deterministic: `buildSparkGeometry` is a
 * pure function over the series, so the rendered path can be asserted in tests
 * without a canvas/WebGL context. `null` samples are *gaps*, not zeros — a
 * vehicle with no derivable ETA breaks the line rather than inventing a value.
 */

/** One sample; `null` means "no reading" and breaks the line. */
export type SparkPoint = number | null;

export interface SparkRun {
  /** `M…L…` subpath for one run of consecutive non-null samples. */
  line: string;
  /** Closed area under that subpath, for the gradient fill. */
  area: string;
}

export interface SparkGeometry {
  runs: SparkRun[];
  /** Combined line subpaths, for a single `<path d>`. */
  line: string;
  /** Position of the latest reading, as a percentage of the box. */
  dot: { left: number; top: number } | null;
  lo: number;
  hi: number;
}

/** Round to 2dp so path strings stay short and stable across platforms. */
function r(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Project a series into an SVG path inside a `width × height` viewBox.
 * Returns null when fewer than two samples carry a reading (nothing to trend).
 * `floor`/`ceiling` pin the value axis when a natural bound exists (speed
 * starts at 0) — otherwise the series auto-scales to its own min/max.
 */
export function buildSparkGeometry(
  data: SparkPoint[],
  width: number,
  height: number,
  floor?: number,
  ceiling?: number
): SparkGeometry | null {
  const readings = data.filter((d): d is number => d != null);
  if (data.length < 2 || readings.length < 2) return null;

  const x0 = 1;
  const x1 = width - 1;
  const xMax = data.length - 1;
  const xScale = (i: number) => x0 + (i / xMax) * (x1 - x0);

  let lo = floor ?? readings[0];
  let hi = ceiling ?? readings[0];
  for (const v of readings) {
    if (floor == null && v < lo) lo = v;
    if (ceiling == null && v > hi) hi = v;
  }
  if (hi <= lo) hi = lo + 1;

  const yBottom = height - 2;
  const yTop = 2;
  const yScale = (v: number) => {
    const clamped = v < lo ? lo : v > hi ? hi : v;
    return yBottom + ((clamped - lo) / (hi - lo)) * (yTop - yBottom);
  };

  // Split into runs of consecutive readings so gaps break the line.
  const runs: SparkRun[] = [];
  let current: Array<[number, number]> = [];
  const flush = () => {
    if (current.length === 0) return;
    const line = `M${current.map(([x, y]) => `${x},${y}`).join("L")}`;
    const first = current[0];
    const last = current[current.length - 1];
    runs.push({ line, area: `${line}L${last[0]},${height}L${first[0]},${height}Z` });
    current = [];
  };
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v == null) {
      flush();
      continue;
    }
    current.push([r(xScale(i)), r(yScale(v))]);
  }
  flush();

  let dot: SparkGeometry["dot"] = null;
  for (let i = data.length - 1; i >= 0; i--) {
    const v = data[i];
    if (v == null) continue;
    dot = { left: (xScale(i) / width) * 100, top: (yScale(v) / height) * 100 };
    break;
  }

  return { runs, line: runs.map((run) => run.line).join(""), dot, lo, hi };
}

export interface SparklineProps {
  data: SparkPoint[];
  /** Accessible name — the chart is otherwise decorative. */
  label: string;
  width?: number;
  height?: number;
  /** A CSS var; accent by default. */
  color?: string;
  /** Pin the bottom of the value axis (speed uses 0). */
  floor?: number;
  className?: string;
}

export default function Sparkline({
  data,
  label,
  width = 120,
  height = 26,
  color = "var(--color-accent)",
  floor,
  className,
}: SparklineProps) {
  const gradientId = useId();
  const geom = useMemo(
    () => buildSparkGeometry(data, width, height, floor),
    [data, width, height, floor]
  );

  if (!geom) return null;

  return (
    <div className={cn("relative block min-w-0 flex-1", className)}>
      <svg
        role="img"
        aria-label={label}
        data-testid="sparkline"
        className="block w-full overflow-visible"
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.24} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {geom.runs.map((run) => (
          <path key={run.line} d={run.area} fill={`url(#${gradientId})`} stroke="none" />
        ))}
        <path
          data-testid="sparkline-path"
          className="fill-none [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.5]"
          d={geom.line}
          stroke={color}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {geom.dot && (
        <span
          data-testid="sparkline-dot"
          className="pointer-events-none absolute size-[4px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${geom.dot.left}%`,
            top: `${geom.dot.top}%`,
            backgroundColor: color,
            boxShadow: `0 0 5px ${color}`,
          }}
        />
      )}
    </div>
  );
}
