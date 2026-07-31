import { useCallback, useId, useMemo, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import { chartTheme } from "./chartTheme";
import { buildSeries, nearestIndexForFraction, type Insets } from "./geometry";

/**
 * One measure plotted against the *shared* time axis. `values` is parallel to
 * the `timestamps` array the parent owns — that parallelism is what makes the
 * facets readable against one another.
 */
export interface FacetSeries {
  id: string;
  label: string;
  unit?: string;
  values: number[];
  format: (value: number) => string;
  /**
   * How one plotted point was derived — surfaced on hover next to the label.
   * Set it whenever the points are not raw samples (a bucket mean reads very
   * differently from a bucket's last counter value, and the chart cannot show
   * that difference on its own).
   */
  hint?: string;
}

export interface TimeSeriesFacetProps {
  series: FacetSeries;
  timestamps: number[];
  xDomain: [number, number];
  /** Measured px width of the plot column (see `useElementWidth`). */
  width: number;
  /** Plot height in px, excluding the facet's own label row. */
  height?: number;
  activeIndex: number | null;
  onActiveIndexChange: (index: number | null) => void;
}

/** Left gutter carries the y ticks; the rest is breathing room. */
export const FACET_INSETS: Insets = { top: 8, right: 8, bottom: 8, left: 34 };

export function TimeSeriesFacet({
  series,
  timestamps,
  xDomain,
  width,
  height = 54,
  activeIndex,
  onActiveIndexChange,
}: TimeSeriesFacetProps) {
  const gradientId = useId();

  const geom = useMemo(() => {
    const data = series.values.map((y, i) => ({ x: timestamps[i], y }));
    return buildSeries(data, { width, height, insets: FACET_INSETS, xDomain, tickCount: 2 });
  }, [series.values, timestamps, width, height, xDomain]);

  const handlePointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!geom) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const plotWidth = geom.box.x1 - geom.box.x0;
      if (rect.width <= 0 || plotWidth <= 0) return;
      const fraction = (event.clientX - rect.left - geom.box.x0) / plotWidth;
      onActiveIndexChange(nearestIndexForFraction(geom.points.length, fraction));
    },
    [geom, onActiveIndexChange]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!geom) return;
      const last = geom.points.length - 1;
      const current = activeIndex ?? last;
      let next: number | null = null;
      if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
      else if (event.key === "ArrowRight") next = Math.min(last, current + 1);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = last;
      else if (event.key === "Escape") {
        onActiveIndexChange(null);
        return;
      }
      if (next === null) return;
      event.preventDefault();
      onActiveIndexChange(next);
    },
    [geom, activeIndex, onActiveIndexChange]
  );

  if (!geom) return null;

  const readIndex = activeIndex != null && activeIndex < geom.points.length ? activeIndex : null;
  const shownValue = series.values[readIndex ?? series.values.length - 1];
  const crosshair = readIndex != null ? geom.points[readIndex] : null;
  const topTick = geom.yTicks[geom.yTicks.length - 1];
  const bottomTick = geom.yTicks[0];

  return (
    <div className="flex flex-col gap-1 py-1.5" data-testid={`facet-${series.id}`}>
      <div className="flex items-baseline justify-between gap-2 pl-[34px] pr-2">
        <span
          className="truncate text-[10.5px] font-medium text-muted-foreground"
          title={series.hint}
          data-testid={`facet-label-${series.id}`}
        >
          {series.label}
        </span>
        {/* Direct label: exactly one number per facet — the crosshair sample,
            or the latest value when nothing is hovered. Never one per point. */}
        <span
          className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-foreground"
          title={series.hint}
        >
          {series.format(shownValue)}
          {series.unit ? (
            <span className="ml-0.5 font-sans text-[9.5px] font-normal text-muted-foreground">
              {series.unit}
            </span>
          ) : null}
        </span>
      </div>

      {/* A focusable plot region: `group` + tabIndex gives keyboard readers the
          same crosshair the pointer gets. Arrow keys walk the samples. */}
      <div
        className="relative cursor-crosshair rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        role="group"
        tabIndex={0}
        aria-label={`${series.label} over time`}
        onPointerMove={handlePointer}
        onPointerLeave={() => onActiveIndexChange(null)}
        onKeyDown={handleKeyDown}
        onBlur={() => onActiveIndexChange(null)}
      >
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
          focusable="false"
          className="block"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor={chartTheme.series}
                stopOpacity={chartTheme.areaOpacity}
              />
              <stop offset="100%" stopColor={chartTheme.series} stopOpacity={0} />
            </linearGradient>
          </defs>

          {/* Hairline gridlines, solid, one step off the surface. */}
          {geom.yTicks.map((tick) => (
            <line
              key={tick}
              x1={geom.box.x0}
              x2={geom.box.x1}
              y1={geom.scaleY(tick)}
              y2={geom.scaleY(tick)}
              stroke={chartTheme.grid}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          ))}

          {/* Only the outer ticks are labelled — the direct label above and the
              table view carry everything in between. */}
          <text
            x={geom.box.x0 - 6}
            y={geom.scaleY(topTick)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-muted-foreground font-mono text-[8.5px] tabular-nums"
          >
            {series.format(topTick)}
          </text>
          <text
            x={geom.box.x0 - 6}
            y={geom.scaleY(bottomTick)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-muted-foreground font-mono text-[8.5px] tabular-nums"
          >
            {series.format(bottomTick)}
          </text>

          <path d={geom.area} fill={`url(#${gradientId})`} stroke="none" />
          <path
            d={geom.line}
            data-testid={`facet-line-${series.id}`}
            fill="none"
            stroke={chartTheme.series}
            strokeWidth={chartTheme.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* End-of-series marker, ringed in the surface colour so it stays
              legible where it sits on the line. */}
          <circle
            cx={geom.last.x}
            cy={geom.last.y}
            r={chartTheme.dotRadius}
            fill={chartTheme.series}
            stroke={chartTheme.surface}
            strokeWidth={2}
          />

          {crosshair ? (
            <g data-testid={`facet-crosshair-${series.id}`}>
              <line
                x1={crosshair.x}
                x2={crosshair.x}
                y1={geom.box.y0}
                y2={geom.box.y1}
                stroke={chartTheme.axis}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <circle
                cx={crosshair.x}
                cy={crosshair.y}
                r={chartTheme.dotRadius}
                fill={chartTheme.series}
                stroke={chartTheme.surface}
                strokeWidth={2}
              />
            </g>
          ) : null}
        </svg>
      </div>
    </div>
  );
}

/** Shared className for the facet stack's hairline separators. */
export const FACET_STACK_CLASS = cn("flex flex-col divide-y divide-border-soft");
