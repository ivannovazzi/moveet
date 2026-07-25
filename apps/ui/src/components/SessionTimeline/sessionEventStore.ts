import { useSyncExternalStore } from "react";

/**
 * Session-level event history for the bottom timeline strip.
 *
 * Distinct from `Inspector/vehicleEventStore` in scope, not in kind: that one
 * answers "what happened to *this vehicle*" and is keyed per vehicle; this one
 * answers "what happened during *this session*" and is a single flat, ordered
 * log spanning the whole fleet. Same bounding strategy — a hard cap with
 * oldest-first eviction — so neither can grow with uptime.
 *
 * Bound: at most `MAX_SESSION_EVENTS` events, oldest evicted. Nothing else is
 * retained (no per-category sub-buffers), so the ceiling is exactly that many
 * small objects however long the tab stays open.
 *
 * The log belongs to one *timeline*: the live session, or one replayed
 * recording. Those have incompatible time axes, so `setTimeline` drops the
 * whole buffer whenever the app crosses that boundary rather than mixing them.
 */

export type SessionEventCategory = "incident" | "geofence-enter" | "geofence-exit" | "dispatch";

export interface SessionEvent {
  /** Monotonic id; stable React key. */
  id: number;
  category: SessionEventCategory;
  /** Epoch ms when the client observed the event. Drives the live axis. */
  at: number;
  /**
   * Offset into the recording, in ms, at the moment the event was observed —
   * present only for events seen during a replay. This is what `seekReplay`
   * takes, so its absence is exactly the "nothing to seek to" condition.
   */
  replayTime?: number;
  label: string;
  detail?: string;
  /** Present when the event is attributable to one vehicle. */
  vehicleId?: string;
}

export type SessionEventInput = Omit<SessionEvent, "id">;

/** Hard cap on retained session events (oldest evicted first). */
export const MAX_SESSION_EVENTS = 200;

/** Identifies which timeline the buffered events belong to. */
export type TimelineKey = string;

export const LIVE_TIMELINE: TimelineKey = "live";

const EMPTY: readonly SessionEvent[] = Object.freeze([]);

class SessionEventStore {
  /** Oldest → newest. Replaced (not mutated) so `useSyncExternalStore` sees a new ref. */
  private events: readonly SessionEvent[] = EMPTY;
  private timeline: TimelineKey = LIVE_TIMELINE;
  private listeners = new Set<() => void>();
  private nextId = 1;

  record(input: SessionEventInput): void {
    const event: SessionEvent = { ...input, id: this.nextId++ };
    const next = [...this.events, event];
    if (next.length > MAX_SESSION_EVENTS) {
      next.splice(0, next.length - MAX_SESSION_EVENTS);
    }
    this.events = next;
    this.notify();
  }

  /** Oldest → newest. Stable reference between recordings. */
  all(): readonly SessionEvent[] {
    return this.events;
  }

  size(): number {
    return this.events.length;
  }

  /**
   * Declare which timeline subsequent events belong to. Crossing a boundary
   * (live → a recording, or between recordings) discards the buffer: the two
   * sets of timestamps are not on the same axis and interleaving them would
   * put ticks at meaningless positions.
   */
  setTimeline(key: TimelineKey): void {
    if (key === this.timeline) return;
    this.timeline = key;
    this.clear();
  }

  currentTimeline(): TimelineKey {
    return this.timeline;
  }

  clear(): void {
    if (this.events.length === 0) return;
    this.events = EMPTY;
    this.notify();
  }

  /** Test seam: forget the timeline too, so a fresh case starts from live. */
  reset(): void {
    this.timeline = LIVE_TIMELINE;
    this.nextId = 1;
    this.clear();
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

export const sessionEventStore = new SessionEventStore();

const subscribe = (callback: () => void) => sessionEventStore.subscribe(callback);
const getSnapshot = () => sessionEventStore.all();

/** Every retained session event, oldest → newest. */
export function useSessionEvents(): readonly SessionEvent[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
