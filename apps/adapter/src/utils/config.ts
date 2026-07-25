import dotenv from "dotenv";
import { z } from "zod";
import { createLogger } from "./logger";
import { loadPluginConfigFile, type FileReader, type PluginConfigFile } from "./configFile";
import type { CircuitBreakerOptions } from "../plugins/circuit-breaker";
import type { OutboxOptions } from "../plugins/outbox";

const logger = createLogger("config");

dotenv.config();

/**
 * Boolean env var. `z.coerce.boolean()` is useless here — it makes the string
 * "false" truthy — so parse the usual textual spellings explicitly. Unset or
 * blank falls back to `fallback`.
 */
function boolFromEnv(fallback: boolean) {
  return z.preprocess((value) => {
    if (value == null || String(value).trim() === "") return fallback;
    return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
  }, z.boolean());
}

/** Integer env var with a default, tolerating an unset-or-blank value. */
function intFromEnv(fallback: number, min: number) {
  return z.preprocess(
    (value) => (value == null || String(value).trim() === "" ? fallback : value),
    z.coerce.number().int().min(min)
  );
}

/**
 * Zod schema for all adapter environment variables.
 */
export const envSchema = z.object({
  /** HTTP server port */
  PORT: z.coerce.number().int().min(1).max(65535).default(5011),

  /** Source plugin type (e.g. "static", "graphql", "rest", "mysql", "postgres") */
  SOURCE_TYPE: z.string().default("static"),

  /** JSON config for the source plugin */
  SOURCE_CONFIG: z.string().default(""),

  /** Comma-separated sink types (e.g. "console", "graphql,redpanda") */
  SINK_TYPES: z.string().default(""),

  /** Comma-separated CORS origins, or "*" for all */
  CORS_ORIGINS: z.string().default("http://localhost:5010,http://localhost:5012"),

  /** JSON config for the realism engine (off by default). */
  REALISM_CONFIG: z.string().default(""),

  /**
   * Optional path to a JSON file holding the source/sink/realism configuration
   * (the readable alternative to the JSON-in-env-var form). Environment
   * variables take precedence over the file — see `loadConfig`.
   */
  ADAPTER_CONFIG_FILE: z.string().default(""),

  /**
   * Base URL of the simulator, used to fetch recordings for replay/emit.
   *
   * The simulator listens on container port 3000, which docker maps to host
   * port 5010 (`5010:3000`). So the correct value depends on the network:
   *  - Local dev (host → host-mapped port): `http://localhost:5010` (the default).
   *  - In compose (adapter container → simulator container, by service name):
   *    `http://simulator:3000` — the container's own port, NOT the host mapping.
   * Both are correct in their respective contexts; this is not a port mismatch.
   */
  SIMULATOR_URL: z.string().default("http://localhost:5010"),

  // --- Delivery hardening (see src/plugins/outbox.ts / circuit-breaker.ts) ---

  /**
   * Opt-in outbox/DLQ. OFF by default: with it off, sink delivery is
   * at-most-once exactly as before (a failed publish is reported and dropped).
   * ON buffers failed batches in memory and redelivers them from the
   * sink-reconnect sweep. NOT restart-durable — see the outbox docs.
   */
  SINK_OUTBOX_ENABLED: boolFromEnv(false),
  /** Max buffered publish batches per sink (drop-oldest beyond this). */
  SINK_OUTBOX_MAX_ENTRIES: intFromEnv(1_000, 1),
  /** Max buffered vehicle updates per sink (drop-oldest beyond this). */
  SINK_OUTBOX_MAX_UPDATES: intFromEnv(50_000, 1),
  /** Redelivery attempts before a buffered batch is dropped as poison. */
  SINK_OUTBOX_MAX_ATTEMPTS: intFromEnv(5, 1),
  /** Also buffer partially-failed publishes (re-sends the whole batch; duplicates). */
  SINK_OUTBOX_RETRY_PARTIAL: boolFromEnv(true),

  /** Per-sink circuit breaker. ON by default — it only ever skips a sink that is already failing. */
  SINK_BREAKER_ENABLED: boolFromEnv(true),
  /** Consecutive whole-sink failures that open the breaker. */
  SINK_BREAKER_FAILURE_THRESHOLD: intFromEnv(5, 1),
  /** How long an open breaker waits before allowing one trial publish (ms). */
  SINK_BREAKER_COOLDOWN_MS: intFromEnv(30_000, 0),
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

/**
 * Parse a JSON config env var. An unset/empty var is fine (→ `{}`), but a set
 * var that isn't valid JSON is a configuration error and must fail loudly
 * rather than silently fall back to defaults.
 */
function parseJSON(value: string | undefined, envVar: string): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch (err) {
    throw new Error(
      `Invalid JSON in environment variable ${envVar}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }
}

function parseCorsOrigins(raw: string): string[] | "*" {
  if (raw.trim() === "*") return "*";
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/** Where a resolved piece of plugin configuration came from. */
export type ConfigOrigin = "env" | "file" | "env+file" | "default";

function originOf(fromEnv: boolean, fromFile: boolean): ConfigOrigin {
  if (fromEnv && fromFile) return "env+file";
  if (fromEnv) return "env";
  if (fromFile) return "file";
  return "default";
}

/** True when an env var is present and not blank (zod defaults hide this). */
function isSet(value: string | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export interface ConfigOrigins {
  /** Absolute path of the config file that contributed, or null when unused. */
  configFile: string | null;
  /** Provenance of the source entry. */
  source: ConfigOrigin;
  /** Provenance of the *list* of sink types. */
  sinkList: ConfigOrigin;
  /** Provenance of each sink's config object, keyed by sink type. */
  sinks: Record<string, ConfigOrigin>;
  realism: ConfigOrigin;
}

/** Resolved delivery-hardening settings handed to `PluginManager.setDeliveryOptions`. */
export interface DeliveryConfig {
  outbox: OutboxOptions;
  breaker: CircuitBreakerOptions;
}

export interface StartupConfig {
  port: number;
  corsOrigins: string[] | "*";
  source: { type: string; config: Record<string, unknown> };
  sinks: Array<{ type: string; config: Record<string, unknown> }>;
  realism: Record<string, unknown>;
  simulatorUrl: string;
  /** Opt-in outbox/DLQ + per-sink circuit-breaker settings. */
  delivery: DeliveryConfig;
  /** Provenance of each resolved piece, for logs and `POST /config/validate`. */
  origins: ConfigOrigins;
}

/**
 * Resolve the startup configuration from environment variables and, when
 * `ADAPTER_CONFIG_FILE` is set, a JSON config file.
 *
 * ## Precedence: environment variables win over the file
 *
 * The file is the readable base; env vars are the per-deployment override
 * (12-factor: the environment is the last word, so a container can override a
 * baked-in file without rewriting it). Concretely:
 *
 *  - `SOURCE_TYPE` overrides the file's `source.type`. When the two name
 *    *different* types, the file's `source.config` is dropped: plugin configs
 *    are type-specific, so carrying it over would be nonsense.
 *  - `SOURCE_CONFIG` is **shallow-merged over** the file's `source.config`
 *    (key by key, env wins), so a file can hold the bulk of the config while an
 *    env var overrides a single key such as a URL or a secret.
 *  - `SINK_TYPES` overrides the file's sink *list* wholesale. Otherwise the
 *    list comes from the file.
 *  - `SINK_<TYPE>_CONFIG` is shallow-merged over the file's config for the same
 *    sink type, same rule as the source.
 *  - `REALISM_CONFIG` is shallow-merged over the file's `realism`.
 *
 * Anything malformed (bad JSON in an env var, unreadable/malformed file)
 * throws: that is a configuration error, not a fail-soft condition.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  readFile?: FileReader
): StartupConfig {
  const parsed = parseEnv(env);

  const loadedFile = loadPluginConfigFile(parsed.ADAPTER_CONFIG_FILE, readFile);
  const file: PluginConfigFile | null = loadedFile?.contents ?? null;

  // --- source ---------------------------------------------------------
  const envSourceTypeSet = isSet(env.SOURCE_TYPE);
  const envSourceConfigSet = isSet(parsed.SOURCE_CONFIG);
  const fileSource = file?.source ?? null;

  const sourceType = envSourceTypeSet ? parsed.SOURCE_TYPE : (fileSource?.type ?? "static");
  // Only inherit the file's config when it describes the same plugin type.
  const fileSourceConfig = fileSource && fileSource.type === sourceType ? fileSource.config : {};
  const sourceConfig: Record<string, unknown> = {
    ...fileSourceConfig,
    ...parseJSON(parsed.SOURCE_CONFIG, "SOURCE_CONFIG"),
  };
  if (sourceType === "static" && !sourceConfig.count) {
    sourceConfig.count = 20;
  }

  // --- sinks ----------------------------------------------------------
  const envSinkTypesSet = isSet(env.SINK_TYPES);
  const fileSinks = file?.sinks ?? [];

  let sinkTypes: string[];
  let sinkListOrigin: ConfigOrigin;
  if (envSinkTypesSet) {
    sinkTypes = parsed.SINK_TYPES.split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    sinkListOrigin = "env";
  } else if (fileSinks.length > 0) {
    sinkTypes = fileSinks.map((s) => s.type);
    sinkListOrigin = "file";
  } else {
    sinkTypes = ["console"];
    sinkListOrigin = "default";
  }

  const sinkOrigins: Record<string, ConfigOrigin> = {};
  const sinks = sinkTypes.map((type) => {
    const envVar = `SINK_${type.toUpperCase()}_CONFIG`;
    const envConfigSet = isSet(env[envVar]);
    const fileEntry = fileSinks.find((s) => s.type === type);
    sinkOrigins[type] = originOf(envConfigSet, fileEntry != null);
    return {
      type,
      config: { ...(fileEntry?.config ?? {}), ...parseJSON(env[envVar], envVar) },
    };
  });

  // --- realism --------------------------------------------------------
  const envRealismSet = isSet(parsed.REALISM_CONFIG);
  const fileRealism = file?.realism ?? {};
  const realism = { ...fileRealism, ...parseJSON(parsed.REALISM_CONFIG, "REALISM_CONFIG") };

  return {
    port: parsed.PORT,
    corsOrigins: parseCorsOrigins(parsed.CORS_ORIGINS),
    source: { type: sourceType, config: sourceConfig },
    sinks,
    realism,
    simulatorUrl: parsed.SIMULATOR_URL,
    delivery: {
      outbox: {
        enabled: parsed.SINK_OUTBOX_ENABLED,
        maxEntries: parsed.SINK_OUTBOX_MAX_ENTRIES,
        maxUpdates: parsed.SINK_OUTBOX_MAX_UPDATES,
        maxAttempts: parsed.SINK_OUTBOX_MAX_ATTEMPTS,
        retryPartial: parsed.SINK_OUTBOX_RETRY_PARTIAL,
      },
      breaker: {
        enabled: parsed.SINK_BREAKER_ENABLED,
        failureThreshold: parsed.SINK_BREAKER_FAILURE_THRESHOLD,
        cooldownMs: parsed.SINK_BREAKER_COOLDOWN_MS,
      },
    },
    origins: {
      configFile: loadedFile?.path ?? null,
      source: originOf(envSourceTypeSet || envSourceConfigSet, fileSource != null),
      sinkList: sinkListOrigin,
      sinks: sinkOrigins,
      realism: originOf(envRealismSet, Object.keys(fileRealism).length > 0),
    },
  };
}

/** Log the resolved config at startup, redacting sink configs that may contain secrets. */
export function logConfig(cfg: StartupConfig): void {
  const redactedSinks = cfg.sinks.map((s) => ({
    type: s.type,
    config: "••••••",
  }));
  const redacted = {
    port: cfg.port,
    source: { type: cfg.source.type, config: "••••••" },
    sinks: redactedSinks,
    configFile: cfg.origins.configFile,
    origins: { source: cfg.origins.source, sinks: cfg.origins.sinks },
    delivery: {
      outbox: cfg.delivery.outbox.enabled
        ? `enabled (in-memory, ≤${cfg.delivery.outbox.maxEntries} batches / ${cfg.delivery.outbox.maxUpdates} updates per sink, drop-oldest; NOT restart-durable)`
        : "disabled (at-most-once)",
      breaker: cfg.delivery.breaker.enabled
        ? `enabled (opens after ${cfg.delivery.breaker.failureThreshold} consecutive failures, ${cfg.delivery.breaker.cooldownMs}ms cooldown)`
        : "disabled",
    },
  };
  logger.info({ config: redacted }, "Adapter config");
}
