import { useSyncExternalStore } from "react";
import type { Bbox } from "./mapsClient";

/**
 * The area a new map is being built from, shared between the Maps panel (which
 * picks it) and the map canvas (which previews it, and lets the operator drag
 * one out). The two live in different React subtrees, so this is a tiny module
 * store rather than context, like `data/mapRevision`.
 */
export interface AreaDraft {
  /** True while the canvas is in drag-a-rectangle mode. */
  drawing: boolean;
  /** The box to preview, or null. */
  bbox: Bbox | null;
  /** Which picker set `bbox`. */
  origin: "preset" | "search" | "draw" | null;
}

const IDLE: AreaDraft = { drawing: false, bbox: null, origin: null };

let state: AreaDraft = IDLE;
const listeners = new Set<() => void>();

function set(next: AreaDraft): void {
  state = next;
  for (const listener of listeners) listener();
}

export function getAreaDraft(): AreaDraft {
  return state;
}

export function setDraftArea(bbox: Bbox | null, origin: AreaDraft["origin"]): void {
  set({ drawing: false, bbox, origin: bbox ? origin : null });
}

/** Enter (or leave) drag-to-draw mode. Entering keeps the old box until a new one is drawn. */
export function setDrawing(drawing: boolean): void {
  if (state.drawing === drawing) return;
  set({ ...state, drawing });
}

/** Drop the preview and leave draw mode: the form closed. */
export function clearAreaDraft(): void {
  if (state === IDLE) return;
  set(IDLE);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAreaDraft(): AreaDraft {
  return useSyncExternalStore(subscribe, getAreaDraft, getAreaDraft);
}
