/**
 * Keys that must never be traversed when resolving a user/config-supplied
 * dot-path, to avoid prototype-pollution gadgets (e.g. `__proto__.polluted`).
 */
export const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** True when no segment of the dot-path is a prototype-pollution key. */
export function isSafePath(path: string): boolean {
  return !path.split(".").some((key) => FORBIDDEN_KEYS.has(key));
}

/**
 * Resolve a dot-path (e.g. `"a.b.c"` or `"metadata.deviceType"`) against an
 * object, returning `undefined` if any segment is missing or the path is unsafe.
 *
 * This is the single, prototype-pollution-guarded dot-path resolver used by all
 * source/sink plugins. Previously each plugin had its own copy with divergent
 * (or absent) guards; consolidating here ensures every dynamic path lookup is
 * uniformly protected.
 *
 * Guard semantics: a path containing any of {@link FORBIDDEN_KEYS} resolves to
 * `undefined` rather than dereferencing the dangerous key. `own`-key membership
 * is checked via `in`, matching prior behaviour for inherited-vs-own lookups on
 * plain JSON shapes (the only inputs these resolvers see).
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  if (!isSafePath(path)) return undefined;
  return path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}
