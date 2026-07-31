import { formatTimeReadout } from "./geometry";
import type { FacetSeries } from "./TimeSeriesFacet";

export interface SeriesTableProps {
  timestamps: number[];
  series: FacetSeries[];
  /** Most recent N samples. Keeps the dock panel from growing without bound. */
  maxRows?: number;
  caption?: string;
}

/**
 * The table twin of the small multiples — the WCAG-clean equivalent.
 *
 * Every value the charts encode with position is reachable here as text, so
 * nothing is gated behind hover or behind colour perception. Newest first,
 * because that is the row a reader wants.
 */
export function SeriesTable({ timestamps, series, maxRows = 40, caption }: SeriesTableProps) {
  const indices: number[] = [];
  for (let i = timestamps.length - 1; i >= 0 && indices.length < maxRows; i--) {
    indices.push(i);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[10.5px]">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-border-soft text-left text-muted-foreground">
            <th scope="col" className="py-1 pr-2 font-medium">
              Time
            </th>
            {series.map((s) => (
              <th
                key={s.id}
                scope="col"
                className="py-1 pl-2 text-right font-medium"
                title={s.hint}
                data-testid={`series-th-${s.id}`}
              >
                {s.label}
                {s.unit ? <span className="ml-0.5 font-normal opacity-70">({s.unit})</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {indices.map((i) => (
            <tr key={timestamps[i]} className="border-b border-border-soft/60 last:border-b-0">
              <th
                scope="row"
                className="py-1 pr-2 text-left font-mono font-normal tabular-nums text-muted-foreground"
              >
                {formatTimeReadout(timestamps[i])}
              </th>
              {series.map((s) => (
                <td
                  key={s.id}
                  className="py-1 pl-2 text-right font-mono tabular-nums text-foreground"
                >
                  {s.format(s.values[i])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
