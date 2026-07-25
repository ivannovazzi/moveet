import { useRef, useState } from "react";
import { Eyebrow } from "@/Dock/DockPanelKit";
import { cn } from "@/lib/utils";
import { formatTimeReadout, formatTimeTick } from "./geometry";
import { FACET_INSETS, TimeSeriesFacet, type FacetSeries } from "./TimeSeriesFacet";
import { useElementWidth } from "./useElementWidth";

export interface SmallMultiplesProps {
  /** Section label above the stack. */
  title?: string;
  /** The shared time axis — every facet's values are parallel to this. */
  timestamps: number[];
  series: FacetSeries[];
  facetHeight?: number;
  className?: string;
}

/** Width used before the first measurement (and under jsdom). */
const FALLBACK_WIDTH = 320;

/**
 * A stack of single-measure facets over **one** shared time axis.
 *
 * The shared axis is the whole point: hovering (or arrowing through) any facet
 * moves the crosshair in every facet at the same instant, so "speed dipped
 * when active vehicles spiked" is readable directly off the stack. Two measures
 * are never folded onto one plot with two y scales — that is the dual-axis
 * anti-pattern; each measure gets its own facet and its own y domain instead.
 */
export function SmallMultiples({
  title,
  timestamps,
  series,
  facetHeight,
  className,
}: SmallMultiplesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef, FALLBACK_WIDTH);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (timestamps.length < 2 || series.length === 0) return null;

  const xDomain: [number, number] = [timestamps[0], timestamps[timestamps.length - 1]];
  const readIndex =
    activeIndex != null && activeIndex >= 0 && activeIndex < timestamps.length ? activeIndex : null;

  const midIndex = Math.floor((timestamps.length - 1) / 2);

  return (
    <section className={cn("flex flex-col", className)}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        {title ? <Eyebrow>{title}</Eyebrow> : <span />}
        <span
          aria-live="polite"
          className="font-mono text-[10px] tabular-nums text-muted-foreground"
          data-testid="small-multiples-readout"
        >
          {readIndex != null
            ? formatTimeReadout(timestamps[readIndex])
            : `latest · ${formatTimeReadout(timestamps[timestamps.length - 1])}`}
        </span>
      </div>

      <div ref={containerRef} className="flex flex-col divide-y divide-border-soft">
        {series.map((s) => (
          <TimeSeriesFacet
            key={s.id}
            series={s}
            timestamps={timestamps}
            xDomain={xDomain}
            width={width}
            height={facetHeight}
            activeIndex={readIndex}
            onActiveIndexChange={setActiveIndex}
          />
        ))}
      </div>

      {/* The one shared x axis, drawn once under the stack. */}
      <div
        className="mt-1 h-px bg-border-soft"
        style={{ marginLeft: FACET_INSETS.left, marginRight: FACET_INSETS.right }}
      />
      <div
        className="flex justify-between pt-1 font-mono text-[9px] tabular-nums text-muted-foreground"
        style={{ paddingLeft: FACET_INSETS.left, paddingRight: FACET_INSETS.right }}
        data-testid="shared-time-axis"
      >
        <span>{formatTimeTick(timestamps[0])}</span>
        {timestamps.length > 2 ? <span>{formatTimeTick(timestamps[midIndex])}</span> : null}
        <span>{formatTimeTick(timestamps[timestamps.length - 1])}</span>
      </div>
    </section>
  );
}

export type { FacetSeries };
