import { cn } from "@/lib/utils";

/**
 * The map's chrome, as a grid rather than a pile of absolutely-positioned boxes.
 *
 * Every HUD surface used to place itself with `absolute` plus a bespoke
 * clearance token — `--spacing-above-dock` so the zoom cluster cleared the dock,
 * `--spacing-row-2` so the inspector cleared the search bar,
 * `--legend-stack-clearance` so the legends cleared the visibility rail. Twelve
 * surfaces, a dozen numbers, and non-overlap held only for as long as every one
 * of those numbers agreed with every other. It did not hold: below roughly
 * 1400px the section panel landed under the inspector, and below roughly 880px
 * the health lamps landed on the search bar.
 *
 * Here the bands are grid tracks, so the clearances are computed rather than
 * declared. Three rows:
 *
 *   row 1  auto           the search band: search bar, mode banner, lamps
 *   row 2  minmax(0,1fr)  the open map: legends, rail, zoom, start hint
 *   row 3  auto           the dock
 *
 * Row 1 and row 3 are sized by their contents, so row 2 is exactly the map that
 * is left over and anything in it is clear of both by construction. A taller
 * dock pushes row 2 up on its own; nothing has to be told about it.
 *
 * The two rows that hold side content use different column templates on purpose,
 * which is why they are separate grids rather than one nine-cell one:
 *
 *   row 1  minmax(auto,1fr) minmax(0,auto) minmax(auto,1fr)
 *          The centre track grows to its content only while there is room and
 *          shrinks first when there is not; the side tracks never drop below
 *          their contents. So the search bar gives up dead-centre before the
 *          lamps give up their corner — centring degrades, overlap does not
 *          happen.
 *   row 2  auto minmax(0,1fr) auto
 *          The opposite priority: the legend column and the inspector are fixed
 *          instruments and hold their width, and the transient centre (the start
 *          hint) takes what is left.
 *
 * The grid itself is click-through; `Region` turns pointer events back on for
 * exactly the box each surface occupies (see `Region`).
 */
export interface ShellGridProps {
  /** Row 1. `topCenter` is the one that holds the viewport's centre line. */
  topLeft?: React.ReactNode;
  topCenter?: React.ReactNode;
  topRight?: React.ReactNode;
  /** Row 2 — the open map. */
  left?: React.ReactNode;
  center?: React.ReactNode;
  right?: React.ReactNode;
  /** Row 3, full width: the dock, which owns its own internal centring. */
  bottom?: React.ReactNode;
  className?: string;
}

/**
 * The shell's one outer margin, and the gap between its bands. 12px, the same
 * number every edge-anchored surface used to repeat as `left-3` / `top-3` /
 * `bottom-3`.
 */
const SHELL_GUTTER = "gap-3 p-3";

export default function ShellGrid({
  topLeft,
  topCenter,
  topRight,
  left,
  center,
  right,
  bottom,
  className,
}: ShellGridProps) {
  return (
    <div
      data-shell-grid=""
      className={cn(
        "pointer-events-none absolute inset-0 z-20 grid",
        "grid-rows-[auto_minmax(0,1fr)_auto]",
        SHELL_GUTTER,
        className
      )}
    >
      <div
        data-shell-row="top"
        className="grid grid-cols-[minmax(auto,1fr)_minmax(0,auto)_minmax(auto,1fr)] items-start gap-3"
      >
        {topLeft ?? <div aria-hidden />}
        {topCenter ?? <div aria-hidden />}
        {topRight ?? <div aria-hidden />}
      </div>

      <div
        data-shell-row="middle"
        className="grid min-h-0 grid-cols-[auto_minmax(0,1fr)_auto] gap-3"
      >
        {left ?? <div aria-hidden />}
        {center ?? <div aria-hidden />}
        {right ?? <div aria-hidden />}
      </div>

      <div data-shell-row="bottom" className="min-w-0">
        {bottom}
      </div>
    </div>
  );
}
