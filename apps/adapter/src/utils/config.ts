import dotenv from "dotenv";

dotenv.config();

export interface StartupConfig {
  port: number;
  source: { type: string; config: Record<string, unknown> };
  sinks: Array<{ type: string; config: Record<string, unknown> }>;
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

function parseSinks(): Array<{ type: string; config: Record<string, unknown> }> {
  const types = process.env.SINK_TYPES;
  if (!types) return [];
  return types
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((type) => ({
      type,
      config: parseJSON(process.env[`SINK_${type.toUpperCase()}_CONFIG`]),
    }));
}

export function loadConfig(): StartupConfig {
  const sourceType = process.env.SOURCE_TYPE || "static";
  const sourceConfig = parseJSON(process.env.SOURCE_CONFIG);

  if (sourceType === "static" && !sourceConfig.count) {
    sourceConfig.count = 20;
  }

  const sinks = parseSinks();

  if (sinks.length === 0 && !process.env.SINK_TYPES) {
    sinks.push({ type: "console", config: {} });
  }

  return {
    port: Number(process.env.PORT) || 5011,
    source: { type: sourceType, config: sourceConfig },
    sinks,
  };
}
