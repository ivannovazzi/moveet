import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { z } from "zod";

dotenv.config();

/**
 * Zod schema for all simulator environment variables.
 * Each field declares its type, default, and constraints.
 */
export const envSchema = z
  .object({
    /** HTTP server port */
    PORT: z.coerce.number().int().min(1).max(65535).default(5010),

    /** Simulation tick interval in ms */
    UPDATE_INTERVAL: z.coerce.number().int().min(1).default(500),

    /** Minimum vehicle speed (km/h) */
    MIN_SPEED: z.coerce.number().min(0).default(20),

    /** Maximum vehicle speed (km/h) */
    MAX_SPEED: z.coerce.number().min(0).default(60),

    /** Acceleration rate (km/h per tick) */
    ACCELERATION: z.coerce.number().min(0).default(5),

    /** Deceleration rate (km/h per tick) */
    DECELERATION: z.coerce.number().min(0).default(7),

    /** Angle threshold for turn detection (degrees) */
    TURN_THRESHOLD: z.coerce.number().min(0).default(30),

    /** Random speed variation factor [0, 1] */
    SPEED_VARIATION: z.coerce.number().min(0).max(1).default(0.1),

    /** Speed multiplier inside heat zones [0, 1] */
    HEATZONE_SPEED_FACTOR: z.coerce.number().min(0).max(1).default(0.5),

    /** Timeout for adapter sync requests in ms */
    SYNC_ADAPTER_TIMEOUT: z.coerce.number().int().min(0).default(5000),

    /** Number of simulated vehicles */
    VEHICLE_COUNT: z.coerce.number().int().min(1).default(70),

    /** Path to the GeoJSON road network file */
    GEOJSON_PATH: z.string().default("./data/network.geojson"),

    /** URL of the adapter service (empty = disabled) */
    ADAPTER_URL: z.string().default(""),
  })
  .refine((data) => data.MAX_SPEED > data.MIN_SPEED, {
    message: "MAX_SPEED must be greater than MIN_SPEED",
    path: ["MAX_SPEED"],
  });

export type EnvConfig = z.infer<typeof envSchema>;

/** Parse and validate environment variables. Throws with descriptive errors on failure. */
export function parseEnv(env: Record<string, string | undefined> = process.env): EnvConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

function buildConfig(env: EnvConfig) {
  return {
    port: env.PORT,
    updateInterval: env.UPDATE_INTERVAL,
    minSpeed: env.MIN_SPEED,
    maxSpeed: env.MAX_SPEED,
    acceleration: env.ACCELERATION,
    deceleration: env.DECELERATION,
    turnThreshold: env.TURN_THRESHOLD,
    speedVariation: env.SPEED_VARIATION,
    heatZoneSpeedFactor: env.HEATZONE_SPEED_FACTOR,
    syncAdapterTimeout: env.SYNC_ADAPTER_TIMEOUT,
    vehicleCount: env.VEHICLE_COUNT,
    geojsonPath: env.GEOJSON_PATH,
    adapterURL: env.ADAPTER_URL,
  } as const;
}

const parsedEnv = parseEnv();
export const config = buildConfig(parsedEnv);

export function verifyConfig(): void {
  // Validate geojsonPath points to an existing file
  if (!config.geojsonPath) {
    throw new Error("Missing required environment variable: GEOJSON_PATH");
  }

  const resolvedPath = path.resolve(config.geojsonPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`GeoJSON file not found at path: ${resolvedPath}`);
  }
}

/** Log the resolved config at startup, redacting sensitive values. */
export function logConfig(): void {
  const redacted = { ...config, adapterURL: config.adapterURL ? "••••••" : "(disabled)" };
  console.log("Simulator config:", JSON.stringify(redacted, null, 2));
}
