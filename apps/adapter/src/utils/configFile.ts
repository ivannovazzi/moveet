import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { z } from "zod";

/**
 * File-based plugin configuration.
 *
 * `SOURCE_CONFIG` / `SINK_<TYPE>_CONFIG` are JSON documents squeezed into
 * environment variables — hard to read, hard to diff, and easy to typo. This
 * module offers the same information as a plain JSON file whose path is given
 * by `ADAPTER_CONFIG_FILE`.
 *
 * The file is only a *transport*: it is merged with the env form in
 * `utils/config.ts` and the merged result is validated by the single
 * schema-driven validator in `plugins/validation.ts`. There is one validation
 * story, not two.
 */

/** One plugin entry: a registered type plus its plugin-specific config object. */
const pluginEntrySchema = z.strictObject({
  type: z.string().trim().min(1, "must be a non-empty string"),
  config: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Shape of the config file. Strict on purpose: a misspelled top-level key
 * (`"sink"` instead of `"sinks"`) is exactly the silent-misconfiguration this
 * feature exists to eliminate, so it is an error rather than an ignored key.
 */
export const pluginConfigFileSchema = z.strictObject({
  source: pluginEntrySchema.optional(),
  sinks: z.array(pluginEntrySchema).default([]),
  realism: z.record(z.string(), z.unknown()).default({}),
});

export type PluginConfigFile = z.infer<typeof pluginConfigFileSchema>;

export interface LoadedConfigFile {
  /** Absolute path the config was read from (useful in logs and API output). */
  path: string;
  contents: PluginConfigFile;
}

/** Injectable reader so tests never touch the real filesystem. */
export type FileReader = (path: string) => string;

/**
 * Read and shape-validate the plugin config file.
 *
 * Returns `null` when no path is configured. Every other failure throws: a
 * configured-but-broken file is a configuration error the operator must fix,
 * never something to silently ignore.
 */
export function loadPluginConfigFile(
  filePath: string | undefined,
  readFile: FileReader = (p) => readFileSync(p, "utf8")
): LoadedConfigFile | null {
  const trimmed = filePath?.trim();
  if (!trimmed) return null;

  const absolute = resolvePath(trimmed);

  let raw: string;
  try {
    raw = readFile(absolute);
  } catch (err) {
    throw new Error(
      `Cannot read adapter config file ${absolute} (from ADAPTER_CONFIG_FILE): ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Invalid JSON in adapter config file ${absolute}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err }
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Invalid adapter config file ${absolute}: expected a JSON object with optional "source", "sinks" and "realism" keys`
    );
  }

  const result = pluginConfigFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.length > 0 ? i.path.join(".") : "<root>"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid adapter config file ${absolute}:\n${issues}`);
  }

  return { path: absolute, contents: result.data };
}
