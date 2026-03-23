import { calculateBackoffDelay } from "./backoff";

const DEFAULT_MAX_RETRIES = 6;
const DEFAULT_BASE_DELAY = 1000;
const DEFAULT_MAX_DELAY = 10_000;

/**
 * Retry an async function with exponential backoff until it returns a
 * non-nullish value, the signal is aborted, or all retries are exhausted.
 *
 * Pass `maxRetries: Infinity` to retry indefinitely (backoff caps at maxDelay).
 */
export async function fetchUntil<T>(
  fn: () => Promise<T | null | undefined>,
  opts: { maxRetries?: number; signal?: AbortSignal } = {}
): Promise<T | null> {
  const { maxRetries = DEFAULT_MAX_RETRIES, signal } = opts;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) return null;
    try {
      const result = await fn();
      if (result != null) return result;
    } catch {
      // Server likely unreachable — will retry
    }
    if (!signal?.aborted) {
      const cappedAttempt = Math.min(attempt, 10);
      const ms = calculateBackoffDelay(cappedAttempt, DEFAULT_BASE_DELAY, DEFAULT_MAX_DELAY);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true }
        );
      });
    }
  }
  return null;
}
