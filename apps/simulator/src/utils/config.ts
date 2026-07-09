import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { z } from "zod";
import logger from "./logger";

dotenv.config();

/**
 * Zod schema for all simulator environment variables.
 * Each field declares its type, default, and constraints.
 */
const envObjectSchema = z.object({
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

  /**
   * How often (ms) to push vehicle positions to the adapter / downstream
   * sinks. 0 (default) means "follow UPDATE_INTERVAL". Runtime-adjustable via
   * the simulation options ("Publish Interval").
   */
  ADAPTER_SYNC_INTERVAL: z.coerce.number().int().min(0).default(0),

  /** Number of simulated vehicles */
  VEHICLE_COUNT: z.coerce.number().int().min(1).default(70),

  /**
   * Optional JSON vehicle type distribution override.
   * e.g. '{"car":50,"truck":10,"bus":7,"motorcycle":3}'
   * When empty, uses the built-in weighted distribution.
   */
  VEHICLE_TYPES: z
    .string()
    .default("")
    .transform((v) => {
      if (!v) return undefined;
      try {
        const parsed = JSON.parse(v);
        if (typeof parsed !== "object" || parsed === null) return undefined;
        return parsed as Partial<Record<string, number>>;
      } catch {
        return undefined;
      }
    }),

  /** Path to the GeoJSON road network file */
  GEOJSON_PATH: z.string().default("./data/network.geojson"),

  /** URL of the adapter service (empty = disabled) */
  ADAPTER_URL: z.string().default(""),

  /** Enable SQLite persistence layer */
  PERSISTENCE_ENABLED: z
    .enum(["true", "false", "1", "0", ""])
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  /** Auto-save interval in seconds (default: 30) */
  PERSISTENCE_INTERVAL: z.coerce.number().int().min(1).default(30),

  /** Restore simulation state from latest snapshot on startup */
  RESTORE_STATE: z
    .enum(["true", "false", "1", "0", ""])
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  /** Path to the SQLite state database */
  STATE_DB_PATH: z.string().default("data/state.db"),

  /** How often (ms) to broadcast/persist the analytics snapshot */
  ANALYTICS_INTERVAL: z.coerce.number().int().min(1).default(5000),

  /** Pino log level */
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  /**
   * WebSocket fan-out transport.
   *  - "inprocess" (default): fan out to WS clients on the simulation thread
   *    (historical behavior, no external dependency).
   *  - "redis": publish serialized broadcast payloads to a Redis pub/sub
   *    channel for a separate, independently-scalable gateway process to fan
   *    out. Requires REDIS_URL; only loads ioredis when selected.
   */
  WS_TRANSPORT: z.enum(["inprocess", "redis"]).default("inprocess"),

  /** Redis connection URL. Required when WS_TRANSPORT=redis (and by the gateway). */
  REDIS_URL: z.string().default(""),

  /** Redis pub/sub channel the simulator publishes to and the gateway subscribes to. */
  WS_PUBSUB_CHANNEL: z.string().default("moveet:ws:broadcast"),

  /** Port the standalone WS gateway listens on (used by ws-gateway entrypoint). */
  WS_GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(5020),

  /**
   * Minimum time (ms) between pathfinding retry attempts for a vehicle that
   * currently has no route. Bounds how aggressively RouteManager re-invokes
   * A* for a vehicle stuck without a reachable destination.
   */
  PATHFIND_COOLDOWN_MS: z.coerce.number().int().min(0).default(3000),

  /**
   * Maximum backoff delay (ms) between adapter sync attempts after
   * consecutive failures. Caps the exponential backoff in
   * AdapterSyncManager so an unhealthy adapter is still retried periodically.
   */
  MAX_SYNC_BACKOFF_MS: z.coerce.number().int().min(0).default(60_000),

  /**
   * Size (N x N) of the coarse sector grid SpatialIndex divides the network
   * bbox into for geographically-uniform random spawn/destination/POI
   * selection. Higher values give finer geographic uniformity at the cost of
   * more (smaller) sector buckets.
   */
  SECTORS_N: z.coerce.number().int().min(1).default(10),
});

export const envSchema = envObjectSchema
  .refine((data) => data.MAX_SPEED > data.MIN_SPEED, {
    message: "MAX_SPEED must be greater than MIN_SPEED",
    path: ["MAX_SPEED"],
  })
  .refine((data) => data.WS_TRANSPORT !== "redis" || data.REDIS_URL.length > 0, {
    message: "REDIS_URL is required when WS_TRANSPORT=redis",
    path: ["REDIS_URL"],
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
    adapterSyncInterval: env.ADAPTER_SYNC_INTERVAL,
    vehicleCount: env.VEHICLE_COUNT,
    vehicleTypes: env.VEHICLE_TYPES,
    geojsonPath: env.GEOJSON_PATH,
    adapterURL: env.ADAPTER_URL,
    persistenceEnabled: env.PERSISTENCE_ENABLED,
    persistenceInterval: env.PERSISTENCE_INTERVAL,
    restoreState: env.RESTORE_STATE,
    stateDbPath: env.STATE_DB_PATH,
    analyticsInterval: env.ANALYTICS_INTERVAL,
    logLevel: env.LOG_LEVEL,
    wsTransport: env.WS_TRANSPORT,
    redisUrl: env.REDIS_URL,
    wsPubSubChannel: env.WS_PUBSUB_CHANNEL,
    wsGatewayPort: env.WS_GATEWAY_PORT,
    pathfindCooldownMs: env.PATHFIND_COOLDOWN_MS,
    maxSyncBackoffMs: env.MAX_SYNC_BACKOFF_MS,
    sectorsN: env.SECTORS_N,
  } as const;
}

const parsedEnv = parseEnv();
export const config = buildConfig(parsedEnv);

/**
 * Standalone parse for the Pino log level.
 *
 * `logger.ts` is imported by this module (for `logConfig`), so it cannot read
 * the `config` singleton without creating a circular dependency where
 * `config.logLevel` is still undefined at logger-init time. This helper applies
 * the same `LOG_LEVEL` schema field in isolation, giving the logger the same
 * validation/default without depending on the fully-built config object.
 */
export function parseLogLevel(env: Record<string, string | undefined> = process.env): string {
  // Self-contained schema (no reference to module-level `const`s) so this can be
  // safely called from logger.ts during the config↔logger import cycle without
  // hitting a temporal-dead-zone error on `envObjectSchema`.
  return z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info")
    .parse(env.LOG_LEVEL);
}

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
  logger.info({ config: redacted }, "Simulator config");
}
