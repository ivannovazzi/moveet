import type { DispatchAssignment, DirectionResult } from "@/types";

export enum DispatchState {
  BROWSE = "BROWSE",
  SELECT = "SELECT",
  ROUTE = "ROUTE",
  DISPATCH = "DISPATCH",
  RESULTS = "RESULTS",
}

interface DispatchSignals {
  dispatchMode: boolean;
  selectedForDispatch: string[];
  assignments: DispatchAssignment[];
  dispatching: boolean;
  results: DirectionResult[];
}

export function deriveDispatchState(signals: DispatchSignals): DispatchState {
  if (!signals.dispatchMode) return DispatchState.BROWSE;
  if (signals.dispatching) return DispatchState.DISPATCH;
  if (signals.results.length > 0) return DispatchState.RESULTS;
  if (signals.selectedForDispatch.length > 0) return DispatchState.ROUTE;
  return DispatchState.SELECT;
}

export function useDispatchState(signals: DispatchSignals): DispatchState {
  return deriveDispatchState(signals);
}

// "grab" is the idle map cursor — DeckGLMap's getCursor only applies its
// hover/drag feedback (pointer/grabbing) when the explicit cursor is "grab",
// so non-override states must map to "grab", not "default".
const CURSOR_BY_STATE: Record<DispatchState, string> = {
  [DispatchState.BROWSE]: "grab",
  [DispatchState.SELECT]: "grab",
  [DispatchState.ROUTE]: "crosshair",
  [DispatchState.DISPATCH]: "wait",
  [DispatchState.RESULTS]: "grab",
};

export function cursorForDispatchState(state: DispatchState | undefined): string {
  if (!state) return "grab";
  return CURSOR_BY_STATE[state];
}
