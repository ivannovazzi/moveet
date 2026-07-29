/**
 * Scale legend for a **sequential magnitude overlay** (one hue, light to dark
 * / transparent to opaque), as opposed to the identity legends next to it
 * (`FleetLegend`, `TypeLegend`) which are categorical swatch lists.
 *
 * The distinction is deliberate and is the whole reason this is a separate
 * component: a categorical legend is a *list of things* and gets one labelled
 * row per entry, while a magnitude legend is *one axis* and must read as a
 * continuous bar with ticks at its ends. Rendering binned magnitude as a
 * column of labelled chips would tell the reader the colours are categories.
 *
 * The steps are therefore contiguous (no inter-swatch gap, single rounded
 * outer edge) even though the underlying encoding is quantized: the reader
 * sees one ordered ramp, and the exact bin boundaries stay available in the
 * screen-reader table below it.
 *
 * ## Reuse
 *
 * Nothing here knows about vehicles. Any overlay that encodes magnitude with a
 * colour ramp (heat zones, the traffic overlay) can render this by passing the
 * *same* colour array it hands its deck.gl layer plus the domain that layer is
 * currently quantizing over. See `quantizeBreaks` for the mapping contract.
 */
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** `[r, g, b]` or `[r, g, b, a]`, 0-255 — deck.gl's colour array shape. */
export type LegendColor = readonly number[];

/**
 * Boundary values of a `colorScaleType: "quantize"` ramp.
 *
 * deck.gl quantizes by normalising each bin value into `[0, 1]` across the
 * domain and sampling a `steps`-wide colour texture with *nearest* filtering,
 * so colour `i` covers `[min + i·w, min + (i+1)·w)` where `w = (max-min)/steps`
 * (the top value falls in the last step). Returns `steps + 1` numbers.
 */
export function quantizeBreaks(domain: readonly [number, number], steps: number): number[] {
  const [min, max] = domain;
  const width = (max - min) / steps;
  const breaks: number[] = [];
  for (let i = 0; i <= steps; i++) breaks.push(min + i * width);
  return breaks;
}

/** Counts are whole numbers; group thousands so a busy city stays readable. */
function defaultFormat(value: number): string {
  return Math.round(value).toLocaleString();
}

function toCss([r, g, b, a]: LegendColor): string {
  return `rgba(${r}, ${g}, ${b}, ${(a ?? 255) / 255})`;
}

export interface ScaleLegendProps {
  /** What the ramp measures, e.g. "Vehicles per bin". */
  title: string;
  /** Optional qualifier under the title, e.g. the bin size. */
  subtitle?: string;
  /**
   * The exact colour array the layer was given. Pass the same reference, not a
   * copy built from the same token, so the legend cannot drift from the map.
   */
  colorRange: readonly LegendColor[];
  /**
   * `[min, max]` the layer is currently quantizing over, or `null` while the
   * first aggregation pass is still in flight. Must come from the layer, never
   * from a parallel calculation.
   */
  domain: readonly [number, number] | null;
  formatValue?: (value: number) => string;
  icon?: LucideIcon;
  /** Positioning — the component only fixes `absolute` and its z-index. */
  className?: string;
  /** Distinguishes multiple legends in the DOM once overlays start sharing this. */
  testId?: string;
}

export default function ScaleLegend({
  title,
  subtitle,
  colorRange,
  domain,
  formatValue = defaultFormat,
  icon: Icon,
  className,
  testId = "scale-legend",
}: ScaleLegendProps) {
  const breaks = domain ? quantizeBreaks(domain, colorRange.length) : null;

  return (
    <div
      role="figure"
      aria-label={title}
      data-testid={testId}
      className={cn(
        // Non-interactive: a continuous scale has nothing to toggle, and the
        // map must stay draggable under it.
        "pointer-events-none absolute z-10 w-[164px] animate-fade-up",
        "rounded-lg border border-border surface-glass p-2.5 shadow-elevated backdrop-blur-md",
        className
      )}
    >
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="size-3 shrink-0 text-muted-foreground" />}
        <span className="truncate text-[11px] font-medium tracking-tight text-foreground">
          {title}
        </span>
      </div>
      {subtitle && (
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{subtitle}</div>
      )}

      {/*
        Solid track behind the swatches: the ramp encodes magnitude partly in
        alpha, and without a fixed backdrop the low steps would composite
        against whatever the glass panel happens to be sitting over.
      */}
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-background ring-1 ring-inset ring-border-soft">
        {colorRange.map((color, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: ramp steps are positional by definition
            key={i}
            data-testid={`${testId}-step`}
            aria-hidden="true"
            className="h-full flex-1"
            style={{ backgroundColor: toCss(color) }}
          />
        ))}
      </div>

      <div className="mt-1 flex items-baseline justify-between text-[10px] tabular-nums text-muted-foreground">
        <span data-testid={`${testId}-min`}>{breaks ? formatValue(breaks[0]) : "—"}</span>
        <span data-testid={`${testId}-max`}>
          {breaks ? formatValue(breaks[breaks.length - 1]) : "—"}
        </span>
      </div>

      {/*
        The exact binning, for screen readers and as the "table view" every
        chart owes its reader. Visually it would be six lines of numbers in a
        164px panel, which is why it is hidden rather than drawn.
      */}
      {breaks && (
        <ul className="sr-only" data-testid={`${testId}-table`}>
          {colorRange.map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: ramp steps are positional by definition
            <li key={i}>
              {`Step ${i + 1} of ${colorRange.length}: ${formatValue(breaks[i])} to ${formatValue(
                breaks[i + 1]
              )}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
