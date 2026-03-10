import type { ConfigField, PluginConfig } from "../plugins/types";

const REDACTED = "••••••";

const SENSITIVE_NAME_PATTERN = /token|password|secret|key|auth|credential/i;

/**
 * Determines whether a config field should be redacted based on:
 * 1. Schema type — fields with type "password" are always sensitive
 * 2. Field name — fields whose name matches common secret patterns
 */
function isSensitiveField(name: string, schema: ConfigField[]): boolean {
  const field = schema.find((f) => f.name === name);
  if (field?.type === "password") return true;
  return SENSITIVE_NAME_PATTERN.test(name);
}

/**
 * Returns a copy of `config` with sensitive values replaced by a redaction marker.
 * Uses the plugin's `configSchema` to identify password-type fields, and also
 * redacts any field whose name matches common secret patterns as a safety net.
 */
export function redactConfig(config: PluginConfig, schema: ConfigField[]): PluginConfig {
  const redacted: PluginConfig = {};
  for (const [key, value] of Object.entries(config)) {
    if (value != null && value !== "" && isSensitiveField(key, schema)) {
      redacted[key] = REDACTED;
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}
