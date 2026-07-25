import { useId, useMemo } from "react";
import { cn } from "@/lib/utils";
import { chartTheme } from "./chartTheme";
import { buildSeries } from "./geometry";

/**
 * One sample. `null` means "no reading" and **breaks the line** — it is never
 * drawn as a zero. See `Datum` in `geometry.ts`.
 */
export type SparkPoint = number | null;

export interface SparklineProps {
  /** Values in time order; index is the x position. `null` is a gap. */
  data: SparkPoint[];
  /** Nominal viewBox height in px — the rendered height too. */
  height?: number;
  /** Nominal viewBox width. The svg stretches to its container regardless. */
  width?: number;
  /** Series hue. Defaults to the one chart hue (`chartTheme.series`). */
  color?: string;
  /**
   * Pin the bottom of the value axis where the measure has a natural zero
   * (speed does; an ETA does not). Without it the series auto-scales to its own
   * min/max, and a vehicle holding a steady 60 km/h draws the same flat line as
   * one that is idling.
   */
  floor?: number;
  /**
   * Accessible name. Supply it when the spark is the *only* rendering of the
   * data; omit it when a printed value sits beside it, in which case the chart
   * is decoration and is hidden from assistive tech rather than read out twice.
   */
  label?: string;
  className?: string;
}

/** Default nominal viewBox width. */
const VIEWBOX_WIDTH = 120;

/** Just enough room for the 1.5px stroke and the end dot not to clip. */
const SPARK_INSETS = { top: 3, right: 3, bottom: 3, left: 3 };

/** A trend needs two readings; one sample is a value, not a line. */
function countReadings(data: SparkPoint[]): number {
  let n = 0;
  for (const v of data) if (v != null && Number.isFinite(v)) n++;
  return n;
}

/**
 * A 2px trend line with a ~10% area wash and an emphasised end dot — a micro
 * chart, not a standalone one: no axes, no gridlines, no labels.
 *
 * Used both as the `trend` slot of a stat tile (where the value it trends is
 * printed beside it, so the spark is decoration-free reinforcement) and as the
 * inspector's live telemetry chart (where `label` gives it an accessible name).
 *
 * Gaps are honest: `null` samples break the stroke instead of being zero-filled,
 * and `floor` pins the axis when the measure has a natural bound. Both come out
 * of the shared `buildSeries` geometry, so the paths are assertable in tests
 * without a canvas.
 *
 * The svg stretches non-uniformly (`preserveAspectRatio="none"`) so the tile
 * can be any width; `vectorEffect="non-scaling-stroke"` keeps the line weight
 * honest, and the end dot is a CSS-positioned element rather than an SVG
 * circle so it stays perfectly round under that stretch.
 */
export function Sparkline({
  data,
  height = 28,
  width = VIEWBOX_WIDTH,
  color,
  floor,
  label,
  className,
}: SparklineProps) {
  const gradientId = useId();
  const hue = color ?? chartTheme.series;

  const geom = useMemo(() => {
    if (countReadings(data) < 2) return null;
    return buildSeries(
      data.map((y, x) => ({ x, y })),
      { width, height, insets: SPARK_INSETS, yFloor: floor }
    );
  }, [data, height, width, floor]);

  if (!geom) return null;

  return (
    <div className={cn("relative block min-w-0 flex-1", className)} data-testid="sparkline">
      <svg
        className="block w-full overflow-visible"
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={hue} stopOpacity={chartTheme.areaOpacity * 2.2} />
            <stop offset="100%" stopColor={hue} stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* One path holding every run's closed subpath — the wash breaks with
            the line rather than washing across a stretch with no readings. */}
        <path
          d={geom.area}
          data-testid="sparkline-area"
          fill={`url(#${gradientId})`}
          stroke="none"
        />
        <path
          d={geom.line}
          data-testid="sparkline-line"
          fill="none"
          stroke={hue}
          strokeWidth={chartTheme.sparkStrokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* Anchored on the latest *reading*, so trailing gaps do not drag the dot
          down to a value that was never measured. */}
      <span
        data-testid="sparkline-dot"
        className="pointer-events-none absolute size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          left: `${(geom.last.x / width) * 100}%`,
          top: `${(geom.last.y / height) * 100}%`,
          backgroundColor: hue,
          boxShadow: `0 0 0 2px ${chartTheme.surface}`,
        }}
      />
    </div>
  );
}
