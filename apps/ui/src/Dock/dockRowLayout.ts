import { useCallback, useEffect, useLayoutEffect, useState } from "react";

/** Keep the row this far from the viewport edges. */
const EDGE_MARGIN = 8;

export interface RowOffsetInput {
  /** Width of the main dock (transport, tempo, mode rail, chips). */
  mainWidth: number;
  /** Width of the whole row, main dock plus the section surfaces. */
  rowWidth: number;
  viewportWidth: number;
}

/**
 * How far to shift the dock row from the viewport's centre line.
 *
 * The row is laid out from `left: 50%`, so the default offset of
 * `-mainWidth / 2` leaves the *main dock* centred and lets the section
 * surfaces run off to its right. That is the promise of the dynamic dock:
 * expanding a section never moves the transport controls under the cursor.
 *
 * The one exception is running out of room — a row that would hang off the
 * right edge slides left just enough to fit, because an unreachable button is
 * worse than a dock that moved.
 */
export function rowOffset({ mainWidth, rowWidth, viewportWidth }: RowOffsetInput): number {
  const centre = viewportWidth / 2;
  const preferred = -mainWidth / 2;
  const maxOffset = viewportWidth - EDGE_MARGIN - rowWidth - centre;
  const minOffset = EDGE_MARGIN - centre;
  if (maxOffset < minOffset) return Math.round(minOffset);
  return Math.round(Math.min(Math.max(preferred, minOffset), maxOffset));
}

export interface AnchorOffsetInput {
  /** Left edge of the surface the floating element is positioned from. */
  originLeft: number;
  /** Left edge of the button it should line up with. */
  anchorLeft: number;
  elementWidth: number;
  viewportWidth: number;
  /** Nudge left of the anchor so padding lines up with the label. */
  inset?: number;
}

/** Keep floating dock surfaces this far inside the viewport edges. */
const FLOAT_MARGIN = 12;

/**
 * Where to put a surface that belongs to a particular button: lined up with
 * that button, pulled back inside the viewport when it would overhang.
 *
 * This is what keeps the section buttons still. They never move to make room
 * for a sub-dock or a panel; those open *at* the button instead, so the row is
 * a fixed set of targets and everything else grows away from it.
 */
export function anchorOffset({
  originLeft,
  anchorLeft,
  elementWidth,
  viewportWidth,
  inset = 0,
}: AnchorOffsetInput): number {
  const desired = anchorLeft - originLeft - inset;
  const min = FLOAT_MARGIN - originLeft;
  const max = viewportWidth - FLOAT_MARGIN - elementWidth - originLeft;
  if (max < min) return Math.round(min);
  return Math.round(Math.min(Math.max(desired, min), max));
}

export interface AnchorPlacement {
  /** Horizontal shift from the origin's left edge. */
  offset: number;
  /**
   * Where the anchor button's centre falls inside the placed element, so it can
   * draw a pointer back at whatever opened it. `null` until measured.
   */
  pointer: number | null;
}

/**
 * Tracks `anchorOffset` for live elements, plus where the anchor sits inside the
 * placed element. Re-measures on resize, when the element resizes, and whenever
 * `key` changes (a different button became the anchor).
 */
export function useAnchorOffset(
  originRef: React.RefObject<HTMLElement | null>,
  anchorRef: React.RefObject<HTMLElement | null>,
  elementRef: React.RefObject<HTMLElement | null>,
  { active, key, inset = 0 }: { active: boolean; key: string; inset?: number }
): AnchorPlacement {
  const [placement, setPlacement] = useState<AnchorPlacement>({ offset: 0, pointer: null });

  const measure = useCallback(() => {
    const origin = originRef.current;
    const element = elementRef.current;
    if (!origin || !element) return;
    const originRect = origin.getBoundingClientRect();
    const anchorRect = anchorRef.current?.getBoundingClientRect() ?? originRect;
    const elementWidth = element.getBoundingClientRect().width;
    const offset = anchorOffset({
      originLeft: originRect.left,
      anchorLeft: anchorRect.left,
      elementWidth,
      viewportWidth: window.innerWidth,
      inset,
    });
    const anchorCentre = anchorRect.left + anchorRect.width / 2 - (originRect.left + offset);
    setPlacement({
      offset,
      pointer: Math.round(Math.min(Math.max(anchorCentre, 14), Math.max(14, elementWidth - 14))),
    });
  }, [originRef, anchorRef, elementRef, inset]);

  useLayoutEffect(() => {
    if (!active) return;
    measure();
  }, [active, measure, key]);

  useEffect(() => {
    if (!active) return;
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    if (elementRef.current) observer?.observe(elementRef.current);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [active, measure, elementRef]);

  return placement;
}

/**
 * How much room is left between an element's left edge and the viewport's right
 * edge. The sections dock caps itself with this so a long section can grow
 * inline without pushing itself off screen — its buttons scroll instead.
 */
export function useAvailableWidth(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean
): number | undefined {
  const [width, setWidth] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    if (!active) {
      setWidth(undefined);
      return;
    }
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      setWidth(Math.max(120, window.innerWidth - FLOAT_MARGIN - el.getBoundingClientRect().left));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ref, active]);

  return width;
}

/**
 * Tracks `rowOffset` for the live element sizes. Re-measures on resize and
 * whenever the row's own size changes, which is what expanding or collapsing a
 * section does.
 */
export function useRowOffset(
  rowRef: React.RefObject<HTMLElement | null>,
  mainRef: React.RefObject<HTMLElement | null>,
  /**
   * True while a section is open. The row is wider then, but it must NOT
   * re-clamp: sliding the row to fit would move the four section buttons, and
   * they are the one thing in the dock that is promised never to move. The
   * section's own buttons scroll inside their dock instead.
   */
  sectionOpen = false
): number {
  const [offset, setOffset] = useState(0);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const main = mainRef.current;
    if (!row || !main) return;

    const measure = () => {
      const mainWidth = main.getBoundingClientRect().width;
      setOffset(
        rowOffset({
          mainWidth,
          rowWidth: sectionOpen ? mainWidth : row.getBoundingClientRect().width,
          viewportWidth: window.innerWidth,
        })
      );
    };

    measure();
    // The observer is what catches expand/collapse; the resize listener covers
    // environments without ResizeObserver (and window resizes).
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    observer?.observe(row);
    observer?.observe(main);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [rowRef, mainRef, sectionOpen]);

  return offset;
}
