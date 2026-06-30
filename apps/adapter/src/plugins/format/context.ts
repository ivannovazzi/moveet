import type { VehicleUpdate } from "../../types";
import { resolvePath, type PayloadTemplate } from "./template";

/**
 * Sink-generic per-message context building + fan-out expansion.
 *
 * Extracted from the redpanda sink. A "context" is the flattened, unit-normalised
 * view of a {@link VehicleUpdate} that templates and `keyField` dot-paths resolve
 * against. This module knows nothing about Kafka/AVRO; it only shapes the data a
 * sink renders.
 */

/**
 * The per-message context every template / `keyField` resolves against. Built
 * once per {@link VehicleUpdate} in {@link buildContext}.
 */
export interface MessageContext {
  id: string;
  type: VehicleUpdate["type"];
  lat: number;
  lon: number;
  heading: number;
  /** Ground speed in km/h. */
  speedKmh: number;
  /** Ground speed in m/s. */
  speed: number;
  ts: number;
  ignition: boolean;
  altitude: number;
  accuracy: number;
  metadata: Record<string, unknown>;
  /**
   * Present only when `fanOut` is configured: the current element of the
   * fanned-out array, so per-device fields are reachable via `device.*` in
   * `keyField` / `payloadTemplate`.
   */
  device?: unknown;
}

/** Defaults applied while building a context for fields the source can't supply. */
export interface ContextDefaults {
  /** Metres above sea level when the update carries none. */
  altitude: number;
  /** GPS horizontal accuracy (m) when the update carries none. */
  accuracy: number;
}

/**
 * Build the per-message context every template / `keyField` resolves against.
 * `speed` is m/s (the trajectory-engine's unit), `speedKmh` is the raw source
 * value. Update-supplied `timestamp`/`accuracy`/`connected` (e.g. from the
 * realism engine) take precedence; otherwise `ts` falls back to the batch
 * `Date.now()`, `accuracy` to the configured default, and `ignition` is derived
 * from m/s speed.
 */
export function buildContext(
  update: VehicleUpdate,
  ts: number,
  defaults: ContextDefaults
): MessageContext {
  const speedKmh = update.speed ?? 0;
  const speed = speedKmh / 3.6; // km/h -> m/s
  return {
    id: update.id,
    type: update.type,
    lat: update.latitude,
    lon: update.longitude,
    heading: update.heading ?? 0,
    speedKmh,
    speed,
    ts: update.timestamp ?? ts,
    // A disconnected fix means ignition off regardless of speed; otherwise
    // derive it from ground speed as before.
    ignition: update.connected === false ? false : speed > 0.5,
    altitude: defaults.altitude,
    accuracy: update.accuracy ?? defaults.accuracy,
    metadata: update.metadata ?? {},
  };
}

/**
 * Expand a batch of updates into per-message contexts, honouring `fanOut`.
 *
 * Without `fanOut` each update yields exactly one context. With `fanOut` set,
 * the array at that dot-path is resolved against the context and each element
 * produces a context carrying `device: <element>` (so the shared
 * position/speed/etc. are co-located across a vehicle's devices, while
 * per-device fields are reachable via `device.*`). A missing/empty array yields
 * nothing for that update.
 */
export function expandContexts(
  updates: VehicleUpdate[],
  fanOut: string | null,
  defaults: ContextDefaults
): MessageContext[] {
  const ts = Date.now();
  return updates.flatMap((update) => {
    const context = buildContext(update, ts, defaults);
    if (!fanOut) return [context];

    const array = resolvePath(context, fanOut);
    if (!Array.isArray(array) || array.length === 0) return [];
    return array.map((device) => ({ ...context, device }));
  });
}

/** Resolve the Kafka/message key for a context via a `keyField` dot-path. */
export function resolveKey(context: MessageContext, keyField: string): string | undefined {
  const keyValue = resolvePath(context, keyField);
  return keyValue === undefined || keyValue === null ? undefined : String(keyValue);
}

// Re-export so callers building a context-driven sink need a single import.
export type { PayloadTemplate };
