import { getNestedValue } from "../utils";

/**
 * Sink-generic payload-template engine.
 *
 * Extracted from the redpanda sink so any sink that wants to shape its outgoing
 * payload from a per-message context (rather than a hard-coded struct) can reuse
 * it. The redpanda sink remains the only consumer today, but the GraphQL/REST
 * sinks could adopt it without copying the resolver logic. The engine itself is
 * format-agnostic: it knows nothing about Kafka, AVRO, or Schema Registry.
 */

/**
 * A single value in a {@link PayloadTemplate}. Resolved per-message against a
 * context object:
 *  - `number` / `boolean` / `null` -> emitted literally.
 *  - `string` starting with `"="` -> literal string (the `=` is stripped).
 *  - any other `string` -> a dot-path into the context; resolving to `undefined`
 *    omits the key entirely.
 *  - nested object -> recursed.
 */
export type TemplateToken = string | number | boolean | null | { [key: string]: TemplateToken };
export type PayloadTemplate = Record<string, TemplateToken>;

/**
 * Resolve a dot-path against a context object. Delegates to the shared
 * prototype-pollution-guarded {@link getNestedValue}.
 */
export const resolvePath = getNestedValue;

/**
 * Resolve a {@link PayloadTemplate} against a context into a plain JSON object.
 * Keys whose value is a path resolving to `undefined` are omitted.
 */
export function resolveTemplate(
  template: PayloadTemplate,
  context: object
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, token] of Object.entries(template)) {
    const resolved = resolveToken(token, context);
    if (resolved !== undefined) out[key] = resolved;
  }
  return out;
}

export function resolveToken(token: TemplateToken, context: object): unknown {
  // Literals: number / boolean / null are emitted verbatim.
  if (typeof token === "number" || typeof token === "boolean" || token === null) {
    return token;
  }
  if (typeof token === "string") {
    // "=literal" -> literal string (strip the leading "=").
    if (token.startsWith("=")) return token.slice(1);
    // Otherwise a dot-path into the context.
    return resolvePath(context, token);
  }
  // Nested object -> recurse.
  return resolveTemplate(token as PayloadTemplate, context);
}

/**
 * Parse + validate an optional payload template from config. Accepts either an
 * already-parsed object or a JSON string (the `json` config field may arrive as
 * either). Returns `null` when unset (callers fall back to a format preset).
 * Throws (with a caller-supplied label prefix) on malformed input.
 */
export function parsePayloadTemplate(
  raw: unknown,
  label = "payloadTemplate"
): PayloadTemplate | null {
  if (raw == null || raw === "") return null;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`${label} is not valid JSON`);
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as PayloadTemplate;
}
