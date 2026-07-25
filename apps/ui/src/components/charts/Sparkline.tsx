import { useId, useMemo } from "react";
import { cn } from "@/lib/utils";
import { chartTheme } from "./chartTheme";
import { buildSeries } from "./geometry";

export interface SparklineProps {
  /** Values in time order; index is the x position. */
  data: number[];
  /** Nominal viewBox height in px — the rendered height too. */
  height?: number;
  /** Series hue. Defaults to the one chart hue (`chartTheme.series`). */
  color?: string;
  className?: string;
}

/** Nominal viewBox width. The svg stretches to its container. */
const VIEWBOX_WIDTH = 120;

/**
 * A 2px trend line with a ~10% area wash and an emphasised end dot — the
 * `trend` slot of a stat tile, not a standalone chart: no axes, no gridlines,
 * no labels. The value it trends is always printed beside it, so the spark is
 * decoration-free reinforcement rather than the only way to read the number.
 *
 * The svg stretches non-uniformly (`preserveAspectRatio="none"`) so the tile
 * can be any width; `vectorEffect="non-scaling-stroke"` keeps the line weight
 * honest, and the end dot is a CSS-positioned element rather than an SVG
 * circle so it stays perfectly round under that stretch.
 */
export function Sparkline({ data, height = 28, color, className }: SparklineProps) {
  const gradientId = useId();
  const hue = color ?? chartTheme.series;

  const geom = useMemo(() => {
    if (data.length < 2) return null;
    return buildSeries(
      data.map((y, x) => ({ x, y })),
      {
        width: VIEWBOX_WIDTH,
        height,
        insets: { top: 3, right: 3, bottom: 3, left: 3 },
      }
    );
  }, [data, height]);

  if (!geom) return null;

  return (
    <div className={cn("relative block min-w-0 flex-1", className)} data-testid="sparkline">
      <svg
        className="block w-full overflow-visible"
        width="100%"
        height={height}
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={hue} stopOpacity={chartTheme.areaOpacity * 2.2} />
            <stop offset="100%" stopColor={hue} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={geom.area} fill={`url(#${gradientId})`} stroke="none" />
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
      <span
        className="pointer-events-none absolute size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          left: `${(geom.last.x / VIEWBOX_WIDTH) * 100}%`,
          top: `${(geom.last.y / height) * 100}%`,
          backgroundColor: hue,
          boxShadow: `0 0 0 2px ${chartTheme.surface}`,
        }}
      />
    </div>
  );
}
