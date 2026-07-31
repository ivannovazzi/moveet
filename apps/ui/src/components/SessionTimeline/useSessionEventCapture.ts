import { useEffect, useRef } from "react";
import client from "@/utils/client";
import type { DirectionResult, IncidentDTO, ReplayStatus } from "@/types";
import type { GeoFenceEvent } from "@moveet/shared-types";
import { LIVE_TIMELINE, sessionEventStore, type TimelineKey } from "./sessionEventStore";

/**
 * Fills `sessionEventStore` from the three things the strip marks: incidents,
 * geofence crossings, and dispatches.
 *
 * Incidents and geofence crossings are WS-sourced (`incident:created`,
 * `geofence:event`). Dispatches are *not* — the simulator's `direction` frame
 * fires for its own autonomous routing too, so keying off it would bury the
 * operator's own dispatches under sim noise. They come instead from the batch
 * result `useDispatchFlow` already produces, which is by definition an
 * operator action.
 *
 * During a replay the recorded frames are re-emitted by `ReplayManager`, so the
 * same handlers fill the strip for the recording. Each event then carries the
 * playback offset it landed at, which is the value `seekReplay` takes.
 */

export interface SessionEventCaptureOptions {
  /** Live/replay mode plus the playback clock. */
  replayStatus: ReplayStatus;
  /** `DispatchFlow.results` — a fresh array per dispatch batch. */
  dispatchResults: DirectionResult[];
}

/** Which timeline the incoming events belong to (see `store.setTimeline`). */
export function timelineKeyFor(replayStatus: ReplayStatus): TimelineKey {
  return replayStatus.mode === "replay"
    ? `replay:${replayStatus.file ?? "unknown"}`
    : LIVE_TIMELINE;
}

/** The playback clock, sampled at the last `replay:status` frame. */
interface ReplayAnchor {
  replaying: boolean;
  paused: boolean;
  currentTime: number;
  duration: number;
  speed: number;
  wall: number;
}

export function useSessionEventCapture({
  replayStatus,
  dispatchResults,
}: SessionEventCaptureOptions): void {
  // `replay:status` frames are sparse, so interpolate between them the same way
  // the dock's replay rail does for its scrubber: last known position plus
  // wall-clock elapsed × speed, clamped to the recording's duration.
  const anchorRef = useRef<ReplayAnchor>({
    replaying: false,
    paused: false,
    currentTime: 0,
    duration: 0,
    speed: 1,
    wall: Date.now(),
  });

  useEffect(() => {
    anchorRef.current = {
      replaying: replayStatus.mode === "replay",
      paused: replayStatus.paused ?? false,
      currentTime: replayStatus.currentTime ?? 0,
      duration: replayStatus.duration ?? 0,
      speed: replayStatus.speed ?? 1,
      wall: Date.now(),
    };
  }, [replayStatus]);

  // Live and each recording are separate time axes — never interleave them.
  const timelineKey = timelineKeyFor(replayStatus);
  useEffect(() => {
    sessionEventStore.setTimeline(timelineKey);
  }, [timelineKey]);

  useEffect(() => {
    /** Playback offset right now, or `undefined` when nothing is playing back. */
    const replayTime = (): number | undefined => {
      const a = anchorRef.current;
      if (!a.replaying) return undefined;
      const elapsed = a.paused ? 0 : (Date.now() - a.wall) * a.speed;
      const at = a.currentTime + elapsed;
      return a.duration > 0 ? Math.min(Math.max(at, 0), a.duration) : Math.max(at, 0);
    };

    const onIncident = (incident: IncidentDTO) => {
      sessionEventStore.record({
        category: "incident",
        at: Date.now(),
        replayTime: replayTime(),
        label: `${incident.type.replace(/_/g, " ")} incident`,
        detail: incident.id,
      });
    };

    const onGeofence = (event: GeoFenceEvent) => {
      const entered = event.event === "enter";
      const parsed = Date.parse(event.timestamp);
      sessionEventStore.record({
        category: entered ? "geofence-enter" : "geofence-exit",
        at: Number.isNaN(parsed) ? Date.now() : parsed,
        replayTime: replayTime(),
        label: `${event.vehicleName || event.vehicleId} ${entered ? "entered" : "exited"} ${
          event.fenceName
        }`,
        detail: event.fenceId,
        vehicleId: event.vehicleId,
      });
    };

    // Guarded: other suites mock the client singleton with a partial stub.
    client.onIncidentCreated?.(onIncident);
    client.onGeofenceEvent?.(onGeofence);
    return () => {
      client.offIncidentCreated?.(onIncident);
      client.offGeofenceEvent?.(onGeofence);
    };
  }, []);

  // One tick per vehicle in each dispatch batch. `results` is replaced wholesale
  // by `handleDispatch`, so identity is the "new batch" signal; it is also reset
  // to `[]` on exit/retry, which this skips.
  const lastResultsRef = useRef<DirectionResult[] | null>(null);
  useEffect(() => {
    if (dispatchResults === lastResultsRef.current) return;
    lastResultsRef.current = dispatchResults;
    if (dispatchResults.length === 0) return;

    const a = anchorRef.current;
    const at = Date.now();
    const offset = a.replaying
      ? Math.max(a.currentTime + (a.paused ? 0 : (at - a.wall) * a.speed), 0)
      : undefined;

    for (const result of dispatchResults) {
      sessionEventStore.record({
        category: "dispatch",
        at,
        replayTime: offset,
        label: result.status === "ok" ? "Vehicle dispatched" : "Dispatch failed",
        detail: result.status === "ok" ? result.vehicleId : (result.error ?? result.vehicleId),
        vehicleId: result.vehicleId,
      });
    }
  }, [dispatchResults]);
}
