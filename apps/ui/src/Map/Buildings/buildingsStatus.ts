import { useSyncExternalStore } from "react";

/**
 * Whether the optional 3D buildings have data, as a tiny module store.
 *
 * The layer lives inside the map (it registers deck.gl layers) but the key that
 * toggles it lives in the left rail, App-level furniture outside the map tree.
 * The rail only needs one fact from the layer, "there is nothing to draw", so
 * it reads it from here rather than through state lifted out of `DeckGLMap`.
 *
 * - `idle`: never asked (the toggle has not been turned on this session)
 * - `loading`: the index request is in flight
 * - `ready`: the simulator has building tiles
 * - `unavailable`: no data generated (404) or the request failed
 *
 * Nothing here fetches; importing it costs nothing while buildings are off.
 */
export type BuildingsStatus = "idle" | "loading" | "ready" | "unavailable";

let status: BuildingsStatus = "idle";
const listeners = new Set<() => void>();

export function getBuildingsStatus(): BuildingsStatus {
  return status;
}

export function setBuildingsStatus(next: BuildingsStatus): void {
  if (next === status) return;
  status = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useBuildingsStatus(): BuildingsStatus {
  return useSyncExternalStore(subscribe, getBuildingsStatus, getBuildingsStatus);
}
