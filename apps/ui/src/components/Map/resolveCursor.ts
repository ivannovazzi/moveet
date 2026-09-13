/**
 * Cursors that mean "no tool owns the pointer" — the map is idle, so deck.gl's
 * own hover/drag feedback should show through.
 *
 * `grab` is the browse idle cursor. `default` is the idle cursor for a mode
 * that manipulates what is already on the map rather than placing something
 * new (editing a heat zone): panning is locked, so promising a grab would lie,
 * but the handles and sprites under the pointer must still light up. Anything
 * outside this set is an explicit mode override (crosshair while picking a
 * point, wait while dispatching) and wins outright.
 */
const IDLE_CURSORS = new Set(["grab", "default"]);

export interface DeckCursorState {
  isDragging: boolean;
  isHovering: boolean;
}

/**
 * Fold deck.gl's hover/drag state into the app's explicit cursor.
 *
 * Only an idle cursor yields to the feedback, and only `grab` becomes
 * `grabbing` — a drag under `default` is a handle drag the map is not panning
 * for, so the arrow stays put.
 */
export function resolveCursor(cursor: string, { isDragging, isHovering }: DeckCursorState): string {
  if (!IDLE_CURSORS.has(cursor)) return cursor;
  if (isDragging) return cursor === "grab" ? "grabbing" : cursor;
  if (isHovering) return "pointer";
  return cursor;
}
