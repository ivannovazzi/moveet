import { useSyncExternalStore } from "react";
import type { MapStatusPayload } from "@/utils/wsTypes";

/**
 * Which simulator map the loaded network belongs to, as a tiny module store.
 *
 * The simulator can hot-swap its road network (`POST /maps/:id/activate`) and
 * announces it on the `map` WebSocket channel. The network, roads, POIs and
 * building tiles are fetched once and cached, so the hooks that load them read
 * the revision from here and refetch when it moves.
 *
 * The first `active` frame (sent on every WebSocket connect) only records the
 * id: the initial fetches already returned that map. A later `active` frame
 * with a different id, live or after a reconnect, bumps the revision.
 */

let activeMapId: string | null = null;
let revision = 0;
const listeners = new Set<() => void>();

export function getMapRevision(): number {
  return revision;
}

/**
 * Feeds a `map` WebSocket frame into the store. Returns true when it switched
 * the client to a different map (the revision moved).
 */
export function handleMapStatus(payload: MapStatusPayload): boolean {
  if (payload.status !== "active") return false;
  const id = payload.map.id;
  if (id === activeMapId) return false;
  const first = activeMapId === null;
  activeMapId = id;
  if (first) return false;
  revision += 1;
  for (const listener of listeners) listener();
  return true;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Increments each time the simulator switches to a different map. */
export function useMapRevision(): number {
  return useSyncExternalStore(subscribe, getMapRevision, getMapRevision);
}

/** Test hook: forget the active map and the revision. */
export function resetMapRevision(): void {
  activeMapId = null;
  revision = 0;
}
