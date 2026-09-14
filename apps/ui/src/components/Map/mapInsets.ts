import { useEffect } from "react";

/**
 * What the map's chrome is currently covering, in CSS pixels per viewport edge.
 *
 * Most of the app no longer covers the map at all: the console holds its own
 * space beside the canvas (see `shell/Console`), so the canvas *is* the visible
 * map on that side. What is left on top of it is the shell's two permanent
 * bands — the search row and the dock row — and a camera move that centres its
 * target on the raw viewport lands it a third of a band too low.
 *
 * Those bands are measured from the rows themselves (`ShellGrid` reports them),
 * not mirrored here as constants. They used to be: `SEARCH_BAND = 74` and
 * `DOCK_BAND = 78`, with a comment asking whoever changed `index.css` to change
 * them too.
 *
 * This is the register of who is covering what. Each contributor reports its
 * own band under a key while it is on screen and drops the key when it leaves;
 * the merged value takes the largest claim per side, so two panels stacked over
 * the same edge count once rather than twice. The camera (`useDeckViewState`)
 * reads the merge at the moment it moves and aims at the centre of what is
 * actually visible.
 *
 * Deliberately a plain module store, like `providers/controls.ts`: contributors
 * and consumers sit on opposite sides of the tree and neither should have to be
 * wrapped in a provider to take part.
 */
export interface MapInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: MapInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Below this much visible width or height the insets are doing more harm than
 * good — on a small window the chrome can claim nearly everything, and pushing
 * the target into the sliver that is left is worse than simply centring it.
 */
export const MIN_VISIBLE = 200;

const contributions = new Map<string, Partial<MapInsets>>();
let merged: MapInsets = NO_INSETS;
const listeners = new Set<() => void>();

function recompute(): void {
  let top = 0;
  let right = 0;
  let bottom = 0;
  let left = 0;
  for (const inset of contributions.values()) {
    if (inset.top && inset.top > top) top = inset.top;
    if (inset.right && inset.right > right) right = inset.right;
    if (inset.bottom && inset.bottom > bottom) bottom = inset.bottom;
    if (inset.left && inset.left > left) left = inset.left;
  }
  merged = { top, right, bottom, left };
  for (const listener of listeners) listener();
}

/** One contributor's own claim, e.g. to lay another surface out beside it. */
export function getInset(key: string): Partial<MapInsets> | undefined {
  return contributions.get(key);
}

/** Notified after every change to the merged insets. Returns the unsubscribe. */
export function subscribeInsets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Claim a band of the viewport under `key`, replacing any previous claim. */
export function setInset(key: string, inset: Partial<MapInsets>): void {
  contributions.set(key, inset);
  recompute();
}

/** Drop `key`'s claim (it left the screen). */
export function clearInset(key: string): void {
  if (contributions.delete(key)) recompute();
}

/** Every live claim, merged by taking the largest per side. */
export function getInsets(): MapInsets {
  return merged;
}

/** Test seam: forget every claim. */
export function resetInsets(): void {
  contributions.clear();
  recompute();
}

/**
 * Report `insets` under `key` for as long as they are non-null and this
 * component is mounted. Pass `null` while the contributor is closed — the claim
 * is dropped rather than reported as zero, so it can be called unconditionally
 * from a component that renders nothing.
 */
export function useReportInset(key: string, insets: Partial<MapInsets> | null): void {
  const { top, right, bottom, left } = insets ?? NO_INSETS;
  const reporting = insets !== null;
  useEffect(() => {
    if (!reporting) {
      clearInset(key);
      return;
    }
    setInset(key, { top, right, bottom, left });
    return () => clearInset(key);
  }, [key, reporting, top, right, bottom, left]);
}

/**
 * Where a camera target should land on screen: the centre of the rectangle the
 * chrome leaves visible, in CSS pixels from the viewport's top-left.
 *
 * Returns `null` when the insets would leave less than `MIN_VISIBLE` in either
 * axis (or the viewport has no size yet), which is the caller's cue to fall
 * back to the plain viewport centre.
 */
export function visibleCentre(
  width: number,
  height: number,
  insets: MapInsets
): [number, number] | null {
  if (!width || !height) return null;
  const visibleWidth = width - insets.left - insets.right;
  const visibleHeight = height - insets.top - insets.bottom;
  if (visibleWidth < MIN_VISIBLE || visibleHeight < MIN_VISIBLE) return null;
  return [insets.left + visibleWidth / 2, insets.top + visibleHeight / 2];
}

/**
 * Padding for a `fitBounds` call: the chrome's own bands plus `base` of air, or
 * `base` on every side when the chrome leaves too little room to be worth
 * avoiding (same guard as `visibleCentre`).
 */
export function fitPadding(
  width: number,
  height: number,
  insets: MapInsets,
  base: number
): { top: number; right: number; bottom: number; left: number } {
  const flat = { top: base, right: base, bottom: base, left: base };
  if (visibleCentre(width, height, insets) === null) return flat;
  return {
    top: insets.top + base,
    right: insets.right + base,
    bottom: insets.bottom + base,
    left: insets.left + base,
  };
}
