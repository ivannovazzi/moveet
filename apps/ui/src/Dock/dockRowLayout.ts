import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getInset, subscribeInsets } from "@/components/Map/mapInsets";

/**
 * Placement for the dock's floating surfaces.
 *
 * The dock *row* itself is laid out in CSS, not here: it is a three-column grid
 * (`1fr auto 1fr`) pinned across the viewport, so the control dock in the middle
 * column sits exactly on the centre line and the two wings live inside their own
 * halves. Neither wing can push the control dock, and neither can grow past its
 * half — a wing that runs out of room wraps or truncates inside it. That is why
 * there is no row-offset measurement any more: there is nothing left to measure.
 *
 * What still needs JavaScript is the panels, which have to line up with the
 * button that opened them and stay inside the viewport.
 */

/**
 * Which edge the floating element lines up with.
 *
 * `anchor` puts its left edge under the button that opened it — right for a
 * panel that belongs to one key (Tempo). `origin-right` puts its *right* edge
 * on the origin surface's right edge, which is what keeps the section panel
 * still: the four section keys are one bar, so a panel hung off the bar's right
 * edge stays exactly where it is while you step Fleet → Monitor → Settings,
 * instead of sliding to whichever key you last pressed.
 */
export type AnchorAlign = "anchor" | "origin-right";

export interface AnchorOffsetInput {
  /** Left edge of the surface the floating element is positioned from. */
  originLeft: number;
  /** Right edge of that surface. Only read when aligning to it. */
  originRight?: number;
  /** Left edge of the button it should line up with. */
  anchorLeft: number;
  elementWidth: number;
  viewportWidth: number;
  /** Nudge left of the anchor so padding lines up with the label. */
  inset?: number;
  align?: AnchorAlign;
  /**
   * Width already spoken for at the viewport's right edge (an open inspector),
   * which the surface is pushed left of rather than laid over.
   */
  reserveRight?: number;
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
  originRight,
  anchorLeft,
  elementWidth,
  viewportWidth,
  inset = 0,
  align = "anchor",
  reserveRight = 0,
}: AnchorOffsetInput): number {
  const desired =
    align === "origin-right"
      ? (originRight ?? originLeft) - elementWidth - originLeft
      : anchorLeft - originLeft - inset;
  const min = FLOAT_MARGIN - originLeft;
  const max = viewportWidth - FLOAT_MARGIN - reserveRight - elementWidth - originLeft;
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
  {
    active,
    key,
    inset = 0,
    align = "anchor",
    avoidInsetKey,
  }: {
    active: boolean;
    key: string;
    inset?: number;
    align?: AnchorAlign;
    /** A `mapInsets` contributor whose right-hand claim this surface stays clear of. */
    avoidInsetKey?: string;
  }
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
      originRight: originRect.right,
      anchorLeft: anchorRect.left,
      elementWidth,
      viewportWidth: window.innerWidth,
      inset,
      align,
      reserveRight: avoidInsetKey ? (getInset(avoidInsetKey)?.right ?? 0) : 0,
    });
    // Where the key sits under the placed surface. A surface pushed clear of
    // its key (out from under an inspector) has nothing to point back at, so
    // the pointer goes rather than aiming at the wrong key.
    const anchorCentre = anchorRect.left + anchorRect.width / 2 - (originRect.left + offset);
    const pointer =
      anchorCentre >= 0 && anchorCentre <= elementWidth
        ? Math.round(Math.min(Math.max(anchorCentre, 14), Math.max(14, elementWidth - 14)))
        : null;
    if (placementRef.current.offset === offset && placementRef.current.pointer === pointer) return;
    placementRef.current = { offset, pointer };
    setPlacement(placementRef.current);
  }, [originRef, anchorRef, elementRef, inset, align, avoidInsetKey]);

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
    const unsubscribe = avoidInsetKey ? subscribeInsets(() => measure()) : undefined;
    return () => {
      observer?.disconnect();
      unsubscribe?.();
      window.removeEventListener("resize", onResize);
    };
  }, [active, measure, elementRef, originRef, avoidInsetKey]);

  return placement;
}
