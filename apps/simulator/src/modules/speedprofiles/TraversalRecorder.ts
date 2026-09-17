/**
 * The `sim` observation source for learned speed profiles (fleetsim-all-1ajn.4):
 * measures how long simulated vehicles take to drive each edge.
 *
 * What is measured is the RUNNING time over the edge only — the movement time
 * (`deltaMs`) a vehicle spends between entering an edge at progress 0 and
 * reaching progress 1 — because the route search already prices the rest
 * separately and must not count it twice:
 *  - node-control delay (`Edge.nodeDelayH`): the movement model has no
 *    stop/signal dwell, and waypoint dwells happen after progress 1 (and are
 *    skipped by `RouteManager` before any movement), so none of it is inside
 *    the measured window;
 *  - turn cost (`pathfinding/turns.ts`): the movement model slows a vehicle for
 *    the WHOLE edge before a turn and it re-accelerates on the edge after one,
 *    so only straight-through traversals are recorded — the edge must be
 *    entered from, and left onto, an edge within `turnThreshold` degrees.
 * Congestion, following distance and heat zones stay in the measurement: they
 * are exactly the "real traffic" a profile is meant to learn.
 *
 * Only vehicles following a route are recorded (the caller's responsibility):
 * a wandering vehicle slows for a guessed next edge that may not be the one it
 * takes. State is keyed by the vehicle object in a WeakMap, so removed vehicles
 * cost nothing and nothing needs resetting.
 */

import type { Edge, Vehicle } from "../../types";

/** Receives one straight-through traversal: the edge and its running speed (km/h). */
export type TraversalSink = (edge: Edge, speedKmh: number) => void;

interface EdgeTraversal {
  edge: Edge;
  elapsedMs: number;
  /** Entered from an edge within the turn threshold. */
  straightEntry: boolean;
}

/** Whether driving from `from` onto `to` is "straight on" (bearing change <= threshold). */
export function isStraightOn(from: Edge, to: Edge, turnThreshold: number): boolean {
  const raw = Math.abs(to.bearing - from.bearing);
  const diff = raw > 180 ? 360 - raw : raw;
  return diff <= turnThreshold;
}

export class TraversalRecorder {
  private readonly traversals = new WeakMap<Vehicle, EdgeTraversal>();

  constructor(private readonly sink: TraversalSink) {}

  /** Adds movement time spent on the vehicle's current edge. */
  accrue(vehicle: Vehicle, ms: number): void {
    const t = this.current(vehicle);
    if (t) t.elapsedMs += ms;
  }

  /**
   * The vehicle reached the end of its current edge after `ms` more movement
   * time and continues onto `next` (null: route finished, nothing follows).
   * Records the traversal when it was a clean straight-through one.
   */
  exit(vehicle: Vehicle, ms: number, next: Edge | null, turnThreshold: number): void {
    const t = this.current(vehicle);
    if (!t) return;
    this.traversals.delete(vehicle);
    const elapsedMs = t.elapsedMs + ms;
    if (!t.straightEntry || !next || !isStraightOn(t.edge, next, turnThreshold)) return;
    if (!(elapsedMs > 0) || !(t.edge.distance > 0)) return;
    this.sink(t.edge, t.edge.distance / (elapsedMs / 3_600_000));
  }

  /** The vehicle moved from the end of `from` onto the start of `to`. */
  enter(vehicle: Vehicle, from: Edge, to: Edge, turnThreshold: number): void {
    this.traversals.set(vehicle, {
      edge: to,
      elapsedMs: 0,
      straightEntry: isStraightOn(from, to, turnThreshold),
    });
  }

  /** The tracked traversal, dropped if the vehicle was moved to another edge meanwhile. */
  private current(vehicle: Vehicle): EdgeTraversal | undefined {
    const t = this.traversals.get(vehicle);
    if (t && t.edge !== vehicle.currentEdge) {
      this.traversals.delete(vehicle);
      return undefined;
    }
    return t;
  }
}
