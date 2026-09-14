import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { clearInset, setInset } from "@/components/Map/mapInsets";

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

/** The same 12px, as a number, for the band measurement above. */
const SHELL_GAP = 12;

/**
 * Tell the camera how much of the map the shell's two permanent bands cover.
 *
 * Only the top and bottom rows do: the console beside the map takes layout
 * space rather than covering the canvas, and the middle row's instruments are
 * narrow and click-through. So what is left to report is exactly the search
 * band and the dock — and now it is *measured*, from the rows themselves.
 *
 * It used to be two constants in `mapInsets` (`SEARCH_BAND = 74`,
 * `DOCK_BAND = 78`) carrying a comment asking whoever changed `index.css` to
 * change them too. A mode banner taller than the search bar, or a dock that
 * grows a row, moved the chrome and left the camera aiming at the old numbers.
 */
function useReportBandInsets(
  gridRef: React.RefObject<HTMLDivElement | null>,
  topRef: React.RefObject<HTMLDivElement | null>,
  bottomRef: React.RefObject<HTMLDivElement | null>
): void {
  useEffect(() => {
    const grid = gridRef.current;
    const top = topRef.current;
    const bottom = bottomRef.current;
    if (!grid || !top || !bottom) return;

    const measure = () => {
      const gridRect = grid.getBoundingClientRect();
      if (!gridRect.height) return;
      const topRect = top.getBoundingClientRect();
      const bottomRect = bottom.getBoundingClientRect();
      // Each band runs from the viewport edge to the far side of its row, plus
      // the gap below (or above) it — the air the row is already holding open.
      setInset("shell-bands", {
        top: Math.max(0, Math.round(topRect.bottom - gridRect.top + SHELL_GAP)),
        bottom: Math.max(0, Math.round(gridRect.bottom - bottomRect.top + SHELL_GAP)),
      });
    };

    measure();
    if (typeof ResizeObserver === "undefined") return () => clearInset("shell-bands");
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    observer.observe(top);
    observer.observe(bottom);
    return () => {
      observer.disconnect();
      clearInset("shell-bands");
    };
  }, [gridRef, topRef, bottomRef]);
}

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
  const gridRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  useReportBandInsets(gridRef, topRef, bottomRef);

  return (
    <div
      ref={gridRef}
      data-shell-grid=""
      className={cn(
        "pointer-events-none absolute inset-0 z-20 grid",
        "grid-rows-[auto_minmax(0,1fr)_auto]",
        SHELL_GUTTER,
        className
      )}
    >
      <div
        ref={topRef}
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

      <div ref={bottomRef} data-shell-row="bottom" className="min-w-0">
        {bottom}
      </div>
    </div>
  );
}
