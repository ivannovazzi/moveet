import dotenv from "dotenv";
import { z } from "zod";
import { createLogger } from "./logger";
import { loadPluginConfigFile, type FileReader, type PluginConfigFile } from "./configFile";

const logger = createLogger("config");

dotenv.config();

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

export interface StartupConfig {
  port: number;
  corsOrigins: string[] | "*";
  source: { type: string; config: Record<string, unknown> };
  sinks: Array<{ type: string; config: Record<string, unknown> }>;
  realism: Record<string, unknown>;
  simulatorUrl: string;
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
  };
  logger.info({ config: redacted }, "Adapter config");
}
