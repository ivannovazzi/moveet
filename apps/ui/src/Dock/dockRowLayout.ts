import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Placement for the dock's one remaining floating surface: the Tempo popover.
 *
 * The dock *row* is laid out in CSS, not here: a three-column grid
 * (`1fr auto 1fr`) across the viewport, so the deck sits on the centre line and
 * the wings live inside their own halves. What still needs JavaScript is a
 * popover, which has to line up with the button that opened it and stay inside
 * the viewport.
 *
 * It used to do considerably more. The section panel floated here too, aligned
 * to the *bar's* right edge rather than to its key, and pushed left by whatever
 * the inspector had claimed at the viewport's right edge (`reserveRight`,
 * fed from `mapInsets`). Two surfaces negotiating one corner at run time, and
 * when the negotiation ran out of room — `max < min`, below roughly 1400px —
 * the panel was placed at the margin, underneath the inspector. Both of those
 * surfaces live in the console now (see `shell/Console`), which holds its own
 * space, so there is nothing left to negotiate with.
 */

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
 * placed element. Re-measures on resize, when the element resizes, when the
 * origin moves (a wing that wraps to a second row moves the surface the panel
 * hangs off), and whenever `key` changes — a different button became the anchor.
 */
export function useAnchorOffset(
  originRef: React.RefObject<HTMLElement | null>,
  anchorRef: React.RefObject<HTMLElement | null>,
  elementRef: React.RefObject<HTMLElement | null>,
  { active, key, inset = 0 }: { active: boolean; key: string; inset?: number }
): AnchorPlacement {
  const [placement, setPlacement] = useState<AnchorPlacement>({ offset: 0, pointer: null });
  // Read through a ref so re-measuring never re-renders on an unchanged result:
  // the observers below fire on every layout pass the dock makes.
  const placementRef = useRef(placement);

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
    // Where the key sits under the placed surface. A surface pulled back inside
    // the viewport can end up clear of its key, and then it has nothing to point
    // back at — so the pointer goes rather than aiming at the wrong key.
    const anchorCentre = anchorRect.left + anchorRect.width / 2 - (originRect.left + offset);
    const pointer =
      anchorCentre >= 0 && anchorCentre <= elementWidth
        ? Math.round(Math.min(Math.max(anchorCentre, 14), Math.max(14, elementWidth - 14)))
        : null;
    if (placementRef.current.offset === offset && placementRef.current.pointer === pointer) return;
    placementRef.current = { offset, pointer };
    setPlacement(placementRef.current);
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
    if (originRef.current) observer?.observe(originRef.current);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [active, measure, elementRef, originRef]);

  return placement;
}
