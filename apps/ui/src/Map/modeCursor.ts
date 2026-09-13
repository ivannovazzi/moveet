import { cursorForDispatchState, type DispatchState } from "@/hooks/useDispatchState";
import type { InteractionModeKind } from "@/hooks/useInteractionMode";

/** Every cursor a mode can ask for. `default` and `grab` are the idle pair
 *  DeckGLMap's resolveCursor lets hover/drag feedback through. */
export type MapCursor = "crosshair" | "default" | "grab" | "grabbing" | "wait" | "pointer";

/**
 * The map cursor for the active interaction mode — one table instead of the
 * ad-hoc branch Map.tsx used to derive from a handful of boolean props.
 *
 * The three point-picking modes get a crosshair (the next click places a
 * point). `edit-heatzone` is a direct-manipulation mode — nothing is being
 * placed, the operator drags handles — so it keeps the plain arrow rather than
 * "grab", which would promise a pan the mode has locked. `dispatch` defers to
 * its own state machine, and browse is the idle "grab" the map hover/drag
 * feedback in DeckGLMap's getCursor keys off.
 */
export function cursorForMode(kind: InteractionModeKind, dispatchState?: DispatchState): MapCursor {
  switch (kind) {
    case "draw-geofence":
    case "draw-heatzone":
    case "place-job":
      return "crosshair";
    case "edit-heatzone":
      return "default";
    case "dispatch":
      // CURSOR_BY_STATE only holds members of MapCursor; it can't say so in its
      // own type without importing back through this module.
      return cursorForDispatchState(dispatchState) as MapCursor;
    case "browse":
      return "grab";
    default:
      // A new member of the union has to decide what a click means here — the
      // compiler says so rather than the mode silently inheriting "grab".
      kind satisfies never;
      return "grab";
  }
}
