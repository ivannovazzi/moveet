import { useCallback, useSyncExternalStore } from "react";

/**
 * Per-vehicle event history for the inspector timeline.
 *
 * The simulator broadcasts per-vehicle occurrences (`vehicle:rerouted`,
 * `geofence:event`, `waypoint:reached`, `route:completed`, `direction`) as
 * fire-and-forget WS frames — nothing on the client retained them, and there is
 * no REST history endpoint. This is that missing retention: a small, strictly
 * bounded client-side buffer filled by `useVehicleEventCapture`.
 *
 * Bounds (both hard):
 *  • at most `MAX_EVENTS_PER_VEHICLE` events per vehicle (oldest evicted)
 *  • at most `MAX_TRACKED_VEHICLES` vehicles (least-recently-active evicted)
 *
 * So the ceiling is 50 × 25 = 1250 small objects, regardless of uptime or
 * fleet size. History starts at page load — it is not backfilled.
 */

export type VehicleEventKind =
  | "route"
  | "reroute"
  | "waypoint"
  | "arrival"
  | "geofence-enter"
  | "geofence-exit";

export interface VehicleEvent {
  /** Monotonic id, used as a stable React key. */
  id: number;
  vehicleId: string;
  kind: VehicleEventKind;
  /** Epoch ms. */
  at: number;
  label: string;
  detail?: string;
}

export type VehicleEventInput = Omit<VehicleEvent, "id">;

export const MAX_EVENTS_PER_VEHICLE = 25;
export const MAX_TRACKED_VEHICLES = 50;

/**
 * A reroute emits `vehicle:rerouted` immediately followed by a `direction`
 * frame for the same vehicle (RouteManager emits both). They are one
 * occurrence, so the `direction` frame is dropped when it trails a reroute
 * inside this window.
 */
const REROUTE_DEDUPE_MS = 1000;

const EMPTY: readonly VehicleEvent[] = Object.freeze([]);

class VehicleEventStore {
  /** Insertion order doubles as LRU: re-inserting a key moves it to the end. */
  private byVehicle = new Map<string, VehicleEvent[]>();
  private listeners = new Set<() => void>();
  private nextId = 1;

  record(input: VehicleEventInput): void {
    const existing = this.byVehicle.get(input.vehicleId) ?? [];
    const tail = existing[existing.length - 1];

    if (
      input.kind === "route" &&
      tail?.kind === "reroute" &&
      input.at - tail.at <= REROUTE_DEDUPE_MS
    ) {
      return;
    }

    const event: VehicleEvent = { ...input, id: this.nextId++ };
    const next = [...existing, event];
    if (next.length > MAX_EVENTS_PER_VEHICLE) {
      next.splice(0, next.length - MAX_EVENTS_PER_VEHICLE);
    }

    // Delete-then-set so this vehicle becomes the most recently active key.
    this.byVehicle.delete(input.vehicleId);
    this.byVehicle.set(input.vehicleId, next);

    while (this.byVehicle.size > MAX_TRACKED_VEHICLES) {
      const oldest = this.byVehicle.keys().next();
      if (oldest.done) break;
      this.byVehicle.delete(oldest.value);
    }

    this.notify();
  }

  /** Oldest → newest. Stable reference while the vehicle has no new events. */
  get(vehicleId: string): readonly VehicleEvent[] {
    return this.byVehicle.get(vehicleId) ?? EMPTY;
  }

  /** Number of vehicles currently retained (bound check / diagnostics). */
  size(): number {
    return this.byVehicle.size;
  }

  clear(): void {
    if (this.byVehicle.size === 0) return;
    this.byVehicle.clear();
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export const vehicleEventStore = new VehicleEventStore();

function subscribe(callback: () => void): () => void {
  return vehicleEventStore.subscribe(callback);
}

/**
 * Events for one vehicle, oldest → newest. Returns a stable reference when
 * that vehicle is unaffected by an incoming event, so unrelated fleet traffic
 * doesn't re-render the inspector.
 */
export function useVehicleEvents(vehicleId: string | undefined): readonly VehicleEvent[] {
  const getSnapshot = useCallback(
    () => (vehicleId ? vehicleEventStore.get(vehicleId) : EMPTY),
    [vehicleId]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
