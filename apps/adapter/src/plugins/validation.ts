import type { ConfigField, PluginConfig } from "./types";

/**
 * Schema-driven validation of a *candidate* plugin set.
 *
 * Every plugin already self-describes its configuration via `configSchema`
 * (`ConfigField[]`), so this module validates against that description instead
 * of hand-written per-plugin checks. It is pure: nothing is instantiated,
 * connected, or mutated — it only reads registered metadata.
 *
 * Two failure classes are deliberately kept apart:
 *
 *  - **error**   — malformed configuration (unknown plugin type, missing
 *                  required field, wrong value type). The operator must fix it;
 *                  the adapter refuses to start on these.
 *  - **warning** — suspicious but survivable (an unknown key that the plugin
 *                  will ignore, usually a typo).
 *
 * Backend reachability is explicitly NOT part of this: a plugin whose config is
 * valid but whose broker is down is the intentional fail-soft case, reported by
 * `GET /health`, not here.
 */

export type IssueSeverity = "error" | "warning";

export interface ConfigIssue {
  /** Config key the issue is about; `null` for whole-plugin issues. */
  field: string | null;
  severity: IssueSeverity;
  message: string;
}

export interface PluginValidation {
  kind: "source" | "sink";
  type: string;
  /** True when the plugin has no error-severity issues (warnings are allowed). */
  valid: boolean;
  /** Where the config came from (env / file / both), when the caller knows. */
  origin?: string;
  /** The candidate config, with secrets redacted — safe to return over HTTP. */
  config: PluginConfig;
  issues: ConfigIssue[];
}

export interface ConfigValidationReport {
  /** True when neither the source nor any sink has an error-severity issue. */
  valid: boolean;
  source: PluginValidation | null;
  sinks: PluginValidation[];
  /** What would actually be activated: only plugins whose config is valid. */
  wouldActivate: { source: string | null; sinks: string[] };
  /** Flattened error messages, prefixed with `source(type)` / `sink(type)`. */
  errors: string[];
  /** Flattened warning messages, same prefixing. */
  warnings: string[];
}

export interface CandidatePlugin {
  type: string;
  config?: PluginConfig;
  /** Optional provenance label, echoed back in the report. */
  origin?: string;
}

export interface CandidatePluginSet {
  source?: CandidatePlugin | null;
  sinks?: CandidatePlugin[];
}

/**
 * The slice of `PluginRegistry` this validator needs. Declared structurally so
 * tests (and any future registry) can supply a stand-in without a real manager.
 */
export interface PluginSchemaProvider {
  getSourceTypes(): string[];
  getSinkTypes(): string[];
  getSourceSchema(type: string): ConfigField[];
  getSinkSchema(type: string): ConfigField[];
  redactSourceConfig(configs: Record<string, PluginConfig>): Record<string, PluginConfig>;
  redactSinkConfig(configs: Record<string, PluginConfig>): Record<string, PluginConfig>;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  const t = typeof value;
  if (t === "object") return "an object";
  return `${t} ${JSON.stringify(value)}`;
}

/** Levenshtein distance, used only for "did you mean" hints on typos. */
function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** Closest candidate within a small edit distance, for typo hints. */
function suggest(value: string, candidates: string[]): string | null {
  let best: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const lower = value.toLowerCase();
  for (const candidate of candidates) {
    const score = editDistance(lower, candidate.toLowerCase());
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  const threshold = Math.max(2, Math.floor(value.length / 3));
  return best !== null && bestScore <= threshold ? best : null;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Validate one value against its declared `ConfigField`. Returns `null` when
 * the value is acceptable.
 *
 * Coercions that the plugins themselves perform are accepted (numeric strings
 * for `number`, `"true"`/`"false"` for `boolean`, case-insensitive `select`
 * values), so validation never rejects a config that would actually work.
 */
function checkValue(field: ConfigField, value: unknown): ConfigIssue | null {
  const error = (message: string): ConfigIssue => ({
    field: field.name,
    severity: "error",
    message,
  });

  switch (field.type) {
    case "number": {
      const n =
        typeof value === "number"
          ? value
          : typeof value === "string" && value.trim() !== ""
            ? Number(value)
            : Number.NaN;
      return Number.isFinite(n) ? null : error(`must be a number (got ${describe(value)})`);
    }
    case "boolean": {
      if (typeof value === "boolean") return null;
      if (typeof value === "string" && ["true", "false"].includes(value.toLowerCase())) return null;
      return error(`must be a boolean (got ${describe(value)})`);
    }
    case "json": {
      if (typeof value === "object") return null;
      if (typeof value === "string") {
        try {
          JSON.parse(value);
          return null;
        } catch {
          return error("must be a JSON object (the string value is not parseable JSON)");
        }
      }
      return error(`must be a JSON object (got ${describe(value)})`);
    }
    case "select": {
      const allowed = (field.options ?? []).map((o) => o.value);
      if (allowed.length === 0) return null;
      const normalized = String(value).toLowerCase();
      if (allowed.some((a) => a.toLowerCase() === normalized)) return null;
      return error(`must be one of [${allowed.join(", ")}] (got ${describe(value)})`);
    }
    default: {
      // "string" and "password"
      return typeof value === "string" ? null : error(`must be a string (got ${describe(value)})`);
    }
  }
}

/** Validate a single plugin's config against its schema. */
export function validatePluginConfig(config: PluginConfig, schema: ConfigField[]): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const known = schema.map((f) => f.name);

  for (const field of schema) {
    const value = config[field.name];
    if (isEmpty(value)) {
      if (field.required) {
        issues.push({
          field: field.name,
          severity: "error",
          message: `required field "${field.name}" is missing or empty`,
        });
      }
      continue;
    }
    const issue = checkValue(field, value);
    if (issue) issues.push(issue);
  }

  for (const key of Object.keys(config)) {
    if (known.includes(key)) continue;
    const hint = suggest(key, known);
    issues.push({
      field: key,
      severity: "warning",
      message: `unknown field "${key}" — it is not in this plugin's config schema and will be ignored${
        hint ? `; did you mean "${hint}"?` : ""
      }`,
    });
  }

  return issues;
}

function validateOne(
  kind: "source" | "sink",
  candidate: CandidatePlugin,
  registry: PluginSchemaProvider
): PluginValidation {
  const type = candidate.type;
  const config = candidate.config ?? {};
  const knownTypes = kind === "source" ? registry.getSourceTypes() : registry.getSinkTypes();
  const redacted =
    kind === "source"
      ? registry.redactSourceConfig({ [type]: config })[type]
      : registry.redactSinkConfig({ [type]: config })[type];

  if (!knownTypes.includes(type)) {
    const hint = suggest(type, knownTypes);
    return {
      kind,
      type,
      valid: false,
      origin: candidate.origin,
      config: redacted,
      issues: [
        {
          field: null,
          severity: "error",
          message: `unknown ${kind} type "${type}" (registered types: ${knownTypes.join(", ")})${
            hint ? `; did you mean "${hint}"?` : ""
          }`,
        },
      ],
    };
  }

  const schema = kind === "source" ? registry.getSourceSchema(type) : registry.getSinkSchema(type);
  const issues = validatePluginConfig(config, schema);

  return {
    kind,
    type,
    valid: !issues.some((i) => i.severity === "error"),
    origin: candidate.origin,
    config: redacted,
    issues,
  };
}

/**
 * Validate a whole candidate plugin set (one source + N sinks) against the
 * registered plugins' `configSchema`s, and report what would be activated.
 */
export function validatePluginSet(
  candidate: CandidatePluginSet,
  registry: PluginSchemaProvider
): ConfigValidationReport {
  const source = candidate.source ? validateOne("source", candidate.source, registry) : null;
  const sinks = (candidate.sinks ?? []).map((s) => validateOne("sink", s, registry));

  const errors: string[] = [];
  const warnings: string[] = [];
  for (const plugin of source ? [source, ...sinks] : sinks) {
    for (const issue of plugin.issues) {
      const line = `${plugin.kind}(${plugin.type})${issue.field ? `.${issue.field}` : ""}: ${issue.message}`;
      (issue.severity === "error" ? errors : warnings).push(line);
    }
  }

  return {
    valid: errors.length === 0,
    source,
    sinks,
    wouldActivate: {
      source: source?.valid ? source.type : null,
      sinks: sinks.filter((s) => s.valid).map((s) => s.type),
    },
    errors,
    warnings,
  };
}
