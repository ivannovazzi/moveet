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

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
