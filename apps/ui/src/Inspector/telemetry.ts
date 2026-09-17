import { useEffect, useState } from "react";
import { vehicleStore } from "@/hooks/vehicleStore";

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
  /**
   * Remaining time to destination in seconds as reported by the simulator, or
   * null when the vehicle has no route.
   *
   * It used to be derived here as `remaining route distance / current speed`,
   * which made the ETA sparkline a mirror image of the speed sparkline
   * directly above it — the same reciprocal-of-speed bug the simulator's own
   * ETA had. The simulator now prices the remaining route with the routing
   * cost model (learned or free-flow edge speeds, node control delays, turn
   * manoeuvres, weather) and sends it on every vehicle sample, so this is read
   * rather than guessed.
   */
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
 * A bounded, 1 Hz rolling telemetry series for one vehicle, polled straight out
 * of `vehicleStore`. Resets when the selected vehicle changes; stops sampling
 * entirely when nothing is selected.
 */
export function useVehicleTelemetry(vehicleId: string | undefined): TelemetrySample[] {
  const [samples, setSamples] = useState<TelemetrySample[]>(EMPTY);

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
        // Absent for an unrouted vehicle: a gap in the series, not a zero.
        eta: dto.etaSeconds ?? null,
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
