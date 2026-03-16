import dotenv from "dotenv";
import { z } from "zod";

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

function parseJSON(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    console.warn(`Failed to parse JSON config: ${value}`);
    return {};
  }
}

function parseCorsOrigins(raw: string): string[] | "*" {
  if (raw.trim() === "*") return "*";
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function parseSinks(env: Record<string, string | undefined>): Array<{ type: string; config: Record<string, unknown> }> {
  const types = env.SINK_TYPES;
  if (!types) return [];
  return types
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((type) => ({
      type,
      config: parseJSON(env[`SINK_${type.toUpperCase()}_CONFIG`]),
    }));
}

export interface StartupConfig {
  port: number;
  corsOrigins: string[] | "*";
  source: { type: string; config: Record<string, unknown> };
  sinks: Array<{ type: string; config: Record<string, unknown> }>;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): StartupConfig {
  const parsed = parseEnv(env);

  const sourceConfig = parseJSON(parsed.SOURCE_CONFIG);
  if (parsed.SOURCE_TYPE === "static" && !sourceConfig.count) {
    sourceConfig.count = 20;
  }

  const sinks = parseSinks(env);

  if (sinks.length === 0 && !parsed.SINK_TYPES) {
    sinks.push({ type: "console", config: {} });
  }

  return {
    port: parsed.PORT,
    corsOrigins: parseCorsOrigins(parsed.CORS_ORIGINS),
    source: { type: parsed.SOURCE_TYPE, config: sourceConfig },
    sinks,
  };
}

/** Log the resolved config at startup, redacting sink configs that may contain secrets. */
export function logConfig(cfg: StartupConfig): void {
  const redactedSinks = cfg.sinks.map((s) => ({ type: s.type, config: "••••••" }));
  const redacted = {
    port: cfg.port,
    source: { type: cfg.source.type, config: "••••••" },
    sinks: redactedSinks,
  };
  console.log("Adapter config:", JSON.stringify(redacted, null, 2));
}
