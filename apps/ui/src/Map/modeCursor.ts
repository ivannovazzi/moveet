import { cursorForDispatchState, type DispatchState } from "@/hooks/useDispatchState";
import type { InteractionModeKind } from "@/hooks/useInteractionMode";

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
export function cursorForMode(kind: InteractionModeKind, dispatchState?: DispatchState): string {
  switch (kind) {
    case "draw-geofence":
    case "draw-heatzone":
    case "place-job":
      return "crosshair";
    case "edit-heatzone":
      return "default";
    case "dispatch":
      return cursorForDispatchState(dispatchState);
    case "browse":
      return "grab";
  }
}
