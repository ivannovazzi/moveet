import { useEffect, useRef, useState } from "react";
import { vehicleStore } from "@/hooks/vehicleStore";
import type { Position, Route } from "@/types";
import { findActiveEdgeIndex } from "@/utils/directionSteps";

/**
 * Telemetry sampling for the inspector's sparklines.
 *
 * **Why polling and not a subscription.** Vehicle position ticks land in
 * `vehicleStore` precisely so React never runs per frame — the map reads the
 * store from a RAF loop instead. The inspector must not undo that, so it never
 * subscribes to the store; it *polls* it on a 1 Hz interval while a vehicle is
 * selected. Worst case that is one React commit per second on a leaf component,
 * regardless of how fast ticks arrive.
 */

/** Sampling cadence (ms). One sample per second — a sparkline needs no more. */
export const TELEMETRY_SAMPLE_MS = 1000;

/** Ring size: 60 samples at 1 Hz = a 60-second window. Hard bound. */
export const TELEMETRY_CAPACITY = 60;

export interface TelemetrySample {
  /** Wall-clock time the sample was taken. */
  t: number;
  /** Reported speed in km/h. */
  speed: number;
  /** Derived time-to-destination in seconds, or null when not derivable. */
  eta: number | null;
}

const EMPTY: TelemetrySample[] = [];

/**
 * Append to a bounded buffer, evicting the oldest samples past `capacity`.
 * Returns a new array (so `useSyncExternalStore`/`useState` see a change).
 */
export function pushSample(
  buffer: TelemetrySample[],
  sample: TelemetrySample,
  capacity: number = TELEMETRY_CAPACITY
): TelemetrySample[] {
  const next = buffer.length >= capacity ? buffer.slice(buffer.length - capacity + 1) : [...buffer];
  next.push(sample);
  return next;
}

/**
 * Live ETA in seconds: remaining route distance ÷ current speed.
 *
 * The simulator only computes an ETA when it *assigns* a route, so
 * `direction.eta` is a constant between route events and would draw a flat
 * line. This recomputes from data the client already holds (route edges +
 * the vehicle's current position and speed), so the series actually moves.
 * Returns null when there is no route, no speed, or the position can't be
 * matched to the route — a gap, never a fabricated value.
 */
export function liveEtaSeconds(
  route: Route | undefined,
  position: Position | undefined,
  speedKmh: number
): number | null {
  if (!route || route.edges.length === 0 || !position) return null;
  if (!Number.isFinite(speedKmh) || speedKmh <= 0) return null;
  const edgeIndex = findActiveEdgeIndex(route.edges, position);
  if (edgeIndex < 0) return null;
  let remainingKm = 0;
  for (let i = edgeIndex; i < route.edges.length; i++) remainingKm += route.edges[i].distance;
  return (remainingKm / speedKmh) * 3600;
}

/**
 * A bounded, 1 Hz rolling telemetry series for one vehicle, polled straight out
 * of `vehicleStore`. Resets when the selected vehicle changes; stops sampling
 * entirely when nothing is selected.
 */
export function useVehicleTelemetry(
  vehicleId: string | undefined,
  route?: Route
): TelemetrySample[] {
  const [samples, setSamples] = useState<TelemetrySample[]>(EMPTY);

  // The route can change mid-flight (reroute). Read it through a ref so a new
  // route doesn't restart the sampler and drop the window.
  const routeRef = useRef(route);
  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  useEffect(() => {
    if (!vehicleId) {
      setSamples(EMPTY);
      return;
    }

    let buffer: TelemetrySample[] = [];
    const take = () => {
      // Direct read of the external store — no subscription, so vehicle ticks
      // between polls cost React nothing.
      const dto = vehicleStore.getAll().get(vehicleId);
      if (!dto) return;
      buffer = pushSample(buffer, {
        t: Date.now(),
        speed: dto.speed,
        // DTO positions are [lat, lng], the same axis order as edge coords.
        eta: liveEtaSeconds(routeRef.current, dto.position, dto.speed),
      });
      setSamples(buffer);
    };

    setSamples(EMPTY);
    take();
    const interval = setInterval(take, TELEMETRY_SAMPLE_MS);
    return () => clearInterval(interval);
  }, [vehicleId]);

  return samples;
}
