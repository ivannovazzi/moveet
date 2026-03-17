export function getNestedValue(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce(
      (current: unknown, key) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined,
      obj
    );
}
