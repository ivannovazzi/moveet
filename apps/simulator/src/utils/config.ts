import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { resolveLandmarkCount } from "../modules/pathfinding/landmarks";
import { parseFreeFlowFactors } from "../modules/roadnetwork/types";
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

  /**
   * Bind heat-zone intensity to the simulated clock. When enabled, zones
   * generated from intersection density are rescaled at every simulated hour
   * boundary by the SAME time-of-day demand curve TrafficManager uses
   * (`utils/trafficProfiles`), so they bloom at rush hour and fade overnight,
   * and a "heatzones" broadcast goes out whenever an intensity actually moves.
   * Manually-drawn zones always keep the operator's intensity.
   *
   * Opt-in (default false): existing deployments keep today's static zones and
   * today's broadcast volume until they ask for the behaviour.
   */
  HEATZONE_TIME_SCALING: z
    .enum(["true", "false", "1", "0", ""])
    .default("false")
    .transform((v) => v === "true" || v === "1"),

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

  /**
   * Default SLA budget (seconds from job creation to completion) applied to a
   * job whose REST body doesn't specify one.
   */
  JOB_SLA_SECONDS: z.coerce.number().int().min(1).default(900),

  /** Seconds a vehicle spends on scene at the pickup before it starts transporting. */
  JOB_PICKUP_DWELL_SECONDS: z.coerce.number().int().min(0).default(30),

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
   * Number of ALT landmarks precomputed for the A* heuristic. `0` disables the
   * preprocessing entirely and restores the exact pre-ALT haversine heuristic;
   * blank, malformed and negative values fall back to the default; anything
   * above the ceiling is clamped rather than rejected, because preprocessing
   * time and memory are both linear in the count.
   *
   * The parse/clamp is `resolveLandmarkCount` from `modules/pathfinding/
   * landmarks` rather than an inline zod chain so the schema and the pathfinding
   * code share ONE implementation of the range. The dependency runs config →
   * landmarks and never the reverse: that module is bundled into the pathfinding
   * worker (esbuild), which must stay free of zod/dotenv/pino. Workers therefore
   * receive the already-resolved number through `PathfindingPool`'s
   * `workerData`, not by re-reading the environment.
   */
  PATHFINDING_LANDMARKS: z
    .string()
    .optional()
    .transform((v) => resolveLandmarkCount(v)),

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

  /**
   * Device-level fault injection (frozen GPS, clock skew, duplicates,
   * reordering, battery death, teleport/spoofing). Opt-in: with this off, or
   * with no profile configured, telemetry is byte-for-byte what it was.
   */
  FAULTS_ENABLED: z
    .enum(["true", "false", "1", "0", ""])
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  /**
   * Seed for the per-device fault RNG streams. Every fault type is reproducible
   * only when this is set; unset means `Math.random` per device.
   */
  FAULT_SEED: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.coerce.number().int().optional()
  ),

  /**
   * Fault profiles as a JSON string: `{"default":{...},"vehicles":{"id":{...}}}`.
   * Validated by `modules/faults/schema.ts` (the same schema the REST API uses);
   * a malformed value aborts startup rather than silently arming nothing.
   */
  FAULT_PROFILES: z.string().default(""),

  /**
   * Per-highway-class free-flow factor overrides, `class=factor` comma list
   * (e.g. `residential=0.5,motorway=0.95`), merged over the defaults in
   * `modules/roadnetwork/types`. Each factor must be in (0, 1]: an edge's
   * free-flow speed (routing cost + movement cap) is posted limit × factor.
   * Resolved here and threaded to the graph builder and pathfinding workers.
   */
  FREE_FLOW_FACTORS: z
    .string()
    .optional()
    .transform((v, ctx) => {
      try {
        return parseFreeFlowFactors(v);
      } catch (err) {
        ctx.addIssue({ code: "custom", message: (err as Error).message });
        return z.NEVER;
      }
    }),

  /**
   * Which side of the road traffic drives on: `right` (default) or `left`.
   * Turn penalties charge the far-side turn (left in right-hand traffic) extra
   * for crossing oncoming traffic. Threaded to the graph and pathfinding workers.
   */
  DRIVE_SIDE: z.enum(["right", "left"]).default("right"),

  // ─── Learned per-edge speed profiles (modules/speedprofiles) ──────

  /**
   * Learn per-edge speeds by time bucket from observed traversals and price
   * routes/ETAs with them once a bucket has enough samples. Opt-in (default
   * false): enabling it changes routing as soon as samples accumulate, and
   * rebuilds the ALT landmark tables on a learned-speed lower bound.
   */
  SPEED_PROFILES_ENABLED: z
    .enum(["true", "false", "1", "0", ""])
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  /**
   * Observation sources, comma list: `sim` (traversals the simulated vehicles
   * drive) and/or `adapter` (real position fixes posted to
   * `POST /speed-profiles/observations`, map-matched to edges).
   */
  SPEED_PROFILE_SOURCES: z
    .string()
    .default("sim")
    .transform((v, ctx) => {
      const parts = [
        ...new Set(
          v
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean)
        ),
      ];
      const bad = parts.filter((p) => p !== "sim" && p !== "adapter");
      if (parts.length === 0 || bad.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: `must be a comma list of sim|adapter (got "${v}")`,
        });
        return z.NEVER;
      }
      return parts as Array<"sim" | "adapter">;
    }),

  /** Profile period: `week` (hour-of-week buckets) or `day` (weekdays folded together). */
  SPEED_PROFILE_PERIOD: z.enum(["week", "day"]).default("week"),

  /** Bucket width in hours; must divide the period (168 h for week, 24 h for day). */
  SPEED_PROFILE_BUCKET_HOURS: z.coerce.number().int().min(1).max(168).default(1),

  /** Samples a bucket needs before its learned speed replaces the static edge cost. */
  SPEED_PROFILE_MIN_SAMPLES: z.coerce.number().int().min(1).max(65535).default(5),

  /** EWMA weight of a new sample, (0, 1]. */
  SPEED_PROFILE_EWMA_ALPHA: z.coerce.number().gt(0).max(1).default(0.2),

  /**
   * Upper clamp on a learned speed as a multiple of the edge's free-flow speed,
   * [1, 3]. The ALT landmark tables are built on distance / (freeFlow × ratio),
   * so a larger ratio lets routing learn faster-than-modelled roads at the cost
   * of a looser heuristic (more nodes expanded per route).
   */
  SPEED_PROFILE_MAX_SPEED_RATIO: z.coerce.number().min(1).max(3).default(1),

  /**
   * Minimum simulated ms between re-publishing the learned table to routing
   * when new samples arrived. A bucket change always publishes immediately.
   */
  SPEED_PROFILE_PUBLISH_INTERVAL_MS: z.coerce.number().int().min(0).default(30_000),

  /** Optional profile JSON file (from `GET /speed-profiles/export`) merged in at startup. */
  SPEED_PROFILE_SEED_FILE: z.string().default(""),

  // ─── Weather (modules/weather) ─────────────────────────────────────

  /**
   * Poll Open-Meteo for live weather at the network's location and apply a
   * global speed factor to routing cost, `estimateTo`, and vehicle movement.
   * Opt-in (default false): with this off, `WeatherManager` still exists (so
   * the manual-override API and WS channel work for scenarios/tests) but never
   * calls `fetch`, and the factor stays 1 (byte-for-byte unchanged routing).
   */
  WEATHER_ENABLED: z
    .enum(["true", "false", "1", "0", ""])
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  /** How often (ms) to poll Open-Meteo for a new reading. */
  WEATHER_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(600_000),

  /** Timeout (ms) for a single Open-Meteo request; the last value is kept on abort/failure. */
  WEATHER_FETCH_TIMEOUT_MS: z.coerce.number().int().min(1).default(5000),

  /**
   * Latitude/longitude to poll. Optional overrides — when unset, `index.ts`
   * uses the loaded network's bounding-box centre instead (resolved there,
   * not in this schema, since it depends on the built graph).
   */
  WEATHER_LAT: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.coerce.number().min(-90).max(90).optional()
  ),
  WEATHER_LON: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.coerce.number().min(-180).max(180).optional()
  ),
});

export const envSchema = envObjectSchema
  .refine((data) => data.MAX_SPEED > data.MIN_SPEED, {
    message: "MAX_SPEED must be greater than MIN_SPEED",
    path: ["MAX_SPEED"],
  })
  .refine((data) => data.WS_TRANSPORT !== "redis" || data.REDIS_URL.length > 0, {
    message: "REDIS_URL is required when WS_TRANSPORT=redis",
    path: ["REDIS_URL"],
  })
  .refine(
    (data) =>
      (data.SPEED_PROFILE_PERIOD === "week" ? 168 : 24) % data.SPEED_PROFILE_BUCKET_HOURS === 0,
    {
      message: "SPEED_PROFILE_BUCKET_HOURS must divide the period (168 for week, 24 for day)",
      path: ["SPEED_PROFILE_BUCKET_HOURS"],
    }
  );

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
    heatZoneTimeScaling: env.HEATZONE_TIME_SCALING,
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
    jobSlaSeconds: env.JOB_SLA_SECONDS,
    jobPickupDwellSeconds: env.JOB_PICKUP_DWELL_SECONDS,
    logLevel: env.LOG_LEVEL,
    wsTransport: env.WS_TRANSPORT,
    redisUrl: env.REDIS_URL,
    wsPubSubChannel: env.WS_PUBSUB_CHANNEL,
    wsGatewayPort: env.WS_GATEWAY_PORT,
    pathfindCooldownMs: env.PATHFIND_COOLDOWN_MS,
    pathfindingLandmarks: env.PATHFINDING_LANDMARKS,
    maxSyncBackoffMs: env.MAX_SYNC_BACKOFF_MS,
    sectorsN: env.SECTORS_N,
    faultsEnabled: env.FAULTS_ENABLED,
    faultSeed: env.FAULT_SEED,
    faultProfiles: env.FAULT_PROFILES,
    freeFlowFactors: env.FREE_FLOW_FACTORS,
    driveSide: env.DRIVE_SIDE,
    speedProfilesEnabled: env.SPEED_PROFILES_ENABLED,
    speedProfileSources: env.SPEED_PROFILE_SOURCES,
    speedProfilePeriod: env.SPEED_PROFILE_PERIOD,
    speedProfileBucketHours: env.SPEED_PROFILE_BUCKET_HOURS,
    speedProfileMinSamples: env.SPEED_PROFILE_MIN_SAMPLES,
    speedProfileEwmaAlpha: env.SPEED_PROFILE_EWMA_ALPHA,
    speedProfileMaxSpeedRatio: env.SPEED_PROFILE_MAX_SPEED_RATIO,
    speedProfilePublishIntervalMs: env.SPEED_PROFILE_PUBLISH_INTERVAL_MS,
    speedProfileSeedFile: env.SPEED_PROFILE_SEED_FILE,
    weatherEnabled: env.WEATHER_ENABLED,
    weatherPollIntervalMs: env.WEATHER_POLL_INTERVAL_MS,
    weatherFetchTimeoutMs: env.WEATHER_FETCH_TIMEOUT_MS,
    weatherLat: env.WEATHER_LAT,
    weatherLon: env.WEATHER_LON,
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
  const redacted = {
    ...config,
    adapterURL: config.adapterURL ? "••••••" : "(disabled)",
  };
  logger.info({ config: redacted }, "Simulator config");
}
