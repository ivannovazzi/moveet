import { z } from "zod";
import type { DeviceFaultProfile } from "../../types";

/**
 * Zod schemas for device fault profiles.
 *
 * ONE validation story: the same schemas validate the `FAULT_PROFILES` env var
 * at startup and every runtime `POST /faults` / `PUT /faults/vehicles/:id`
 * body. Objects are `.strict()` on purpose — a mistyped key in a fault profile
 * would otherwise be silently ignored, and an operator would be left believing
 * a fault was armed when it was not.
 */

const probability = z.number().min(0).max(1);
const durationMs = z.number().int().min(0);

export const faultProfileSchema = z
  .object({
    frozenGps: z
      .object({
        probability,
        minDurationMs: durationMs,
        maxDurationMs: durationMs,
      })
      .strict()
      .refine((v) => v.maxDurationMs >= v.minDurationMs, {
        message: "maxDurationMs must be >= minDurationMs",
        path: ["maxDurationMs"],
      })
      .optional(),
    clockSkew: z
      .object({
        offsetMs: z.number().int(),
        driftMsPerMinute: z.number().optional(),
      })
      .strict()
      .optional(),
    duplicate: z
      .object({
        probability,
        maxCopies: z.number().int().min(1).max(10),
      })
      .strict()
      .optional(),
    outOfOrder: z
      .object({
        probability,
        holdMs: durationMs,
      })
      .strict()
      .optional(),
    battery: z
      .object({
        initialPercent: z.number().min(0).max(100),
        drainPercentPerHour: z.number().min(0),
        dieAtPercent: z.number().min(0).max(100),
      })
      .strict()
      .optional(),
    teleport: z
      .object({
        probability,
        radiusMeters: z.number().min(0),
        holdMs: durationMs,
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Runtime reconfiguration body. Every field is optional so a caller can flip
 * `enabled` without restating the profiles. `default: null` clears the
 * fleet-wide profile (there is no other way to express "remove it").
 */
export const faultConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    seed: z.number().int().optional(),
    default: faultProfileSchema.nullable().optional(),
    vehicles: z.record(z.string().min(1), faultProfileSchema).optional(),
  })
  .strict();

/** Shape of the `FAULT_PROFILES` env var: profiles only, no engine flags. */
export const faultProfilesEnvSchema = z
  .object({
    default: faultProfileSchema.optional(),
    vehicles: z.record(z.string().min(1), faultProfileSchema).optional(),
  })
  .strict();

export type FaultConfigPatch = z.infer<typeof faultConfigSchema>;

export interface FaultProfilesEnv {
  default?: DeviceFaultProfile;
  vehicles?: Record<string, DeviceFaultProfile>;
}

/**
 * Parses and validates the `FAULT_PROFILES` env var. Throws (aborting startup)
 * on malformed JSON or a schema violation: a fault layer that silently armed
 * nothing because of a typo is worse than a boot failure.
 */
export function parseFaultProfilesEnv(raw: string): FaultProfilesEnv {
  if (!raw.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`FAULT_PROFILES is not valid JSON: ${message}`);
  }

  const result = faultProfilesEnvSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid FAULT_PROFILES:\n${issues}`);
  }
  return result.data;
}
