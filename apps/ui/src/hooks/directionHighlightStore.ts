import { useSyncExternalStore } from "react";

/**
 * A reference to one turn-by-turn step: the vehicle it belongs to and the
 * half-open edge range `[start, end)` within that vehicle's `route.edges`.
 */
export interface StepRef {
  vehicleId: string;
  start: number;
  end: number;
}

/**
 * Tiny external store for "which direction step is highlighted on the map".
 * Lives outside React (like `vehicleStore`) so hovering rows in the inspector
 * doesn't re-render App — only the two subscribers (the map `Direction` layer
 * and the inspector step list) update. `hovered` is transient (row hover);
 * `pinned` survives until toggled off or the selection changes. The map draws
 * `hovered ?? pinned`.
 */
interface HighlightState {
  hovered: StepRef | null;
  pinned: StepRef | null;
}

let state: HighlightState = { hovered: null, pinned: null };
const listeners = new Set<() => void>();

function emit(next: HighlightState) {
  state = next;
  for (const listener of listeners) listener();
}

/** Two step refs point at the same step (ignores `end`, `start` is unique). */
export function sameStep(a: StepRef | null, b: StepRef | null): boolean {
  return !!a && !!b && a.vehicleId === b.vehicleId && a.start === b.start;
}

export function setHoveredStep(step: StepRef | null) {
  if (sameStep(state.hovered, step) && !!state.hovered === !!step) return;
  emit({ ...state, hovered: step });
}

/** Toggle the pinned step: clicking the already-pinned step clears it. */
export function togglePinnedStep(step: StepRef) {
  emit({ ...state, pinned: sameStep(state.pinned, step) ? null : step });
}

export function clearDirectionHighlight() {
  if (!state.hovered && !state.pinned) return;
  emit({ hovered: null, pinned: null });
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): HighlightState {
  return state;
}

export function useDirectionHighlight(): HighlightState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
