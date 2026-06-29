import { z } from "zod";
import type { VehicleUpdate } from "../types";

/**
 * Zod schema for an inbound `/sync` vehicle update, replacing the prior
 * hand-rolled checks (and the `as unknown as VehicleUpdate` cast). Required
 * fields mirror the previous validation exactly — `id` (string), `latitude` and
 * `longitude` (numbers) — while the optional telemetry fields from the shared
 * `VehicleUpdate` type are accepted and carried through. `metadata`, when
 * present, must be a plain JSON object (not an array/null), matching the old
 * behaviour. Unknown extra keys are stripped rather than rejected, preserving
 * the prior leniency about extra source-provided fields on the hot path.
 */
export const vehicleUpdateSchema = z.object({
  id: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  type: z.string().optional(),
  speed: z.number().optional(),
  heading: z.number().optional(),
  accuracy: z.number().optional(),
  timestamp: z.number().optional(),
  connected: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Validate a batch of raw items into `VehicleUpdate`s, preserving the existing
 * per-item error reporting: each element is `safeParse`d independently so a
 * single bad item produces a precise `vehicles[i]: ...` message rather than
 * failing the whole batch opaquely.
 */
export function validateVehicleUpdates(raw: unknown[]): {
  vehicles: VehicleUpdate[];
  invalid: string[];
} {
  const vehicles: VehicleUpdate[] = [];
  const invalid: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const result = vehicleUpdateSchema.safeParse(raw[i]);
    if (result.success) {
      vehicles.push(result.data as VehicleUpdate);
    } else {
      const detail = result.error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
          return `${path}: ${issue.message}`;
        })
        .join("; ");
      invalid.push(`vehicles[${i}]: ${detail}`);
    }
  }

  return { vehicles, invalid };
}
