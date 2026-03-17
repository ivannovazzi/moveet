/** Unified HTTP client with retry, timeout, and consistent error handling. */

export class HttpClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "HttpClientError";
  }
}

export class HttpTimeoutError extends HttpClientError {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`, undefined, true);
    this.name = "HttpTimeoutError";
  }
}

export interface HttpClientOptions {
  /** Request timeout in milliseconds. Default: 10000 */
  timeoutMs?: number;
  /** Maximum number of attempts (1 = no retry). Default: 3 */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff. Default: 500 */
  baseDelayMs?: number;
  /** Maximum backoff delay in milliseconds. Default: 10000 */
  maxDelayMs?: number;
  /** Sleep implementation, overridable for testing. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_OPTIONS: Required<HttpClientOptions> = {
  timeoutMs: 10_000,
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Status codes that should be retried. */
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function isRetryable(error: unknown): boolean {
  if (error instanceof HttpClientError) return error.retryable;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof TypeError) return true; // network errors
  return false;
}

/**
 * Compute backoff delay with full jitter.
 * Formula: random(0, min(maxDelay, baseDelay * 2^attempt))
 */
function computeBackoff(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponentialDelay, maxDelayMs);
  return Math.random() * capped;
}

/**
 * Execute a fetch request with timeout, exponential backoff retry, and
 * consistent error types.
 */
export async function httpFetch(
  url: string,
  init: RequestInit = {},
  options: HttpClientOptions = {}
): Promise<Response> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt < opts.maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = computeBackoff(attempt - 1, opts.baseDelayMs, opts.maxDelayMs);
      await opts.sleep(delay);
    }

    try {
      const response = await fetchWithTimeout(url, init, opts.timeoutMs);

      if (response.ok) {
        return response;
      }

      const retryable = RETRYABLE_STATUS_CODES.has(response.status);
      const error = new HttpClientError(
        `HTTP ${response.status} ${response.statusText}`,
        response.status,
        retryable
      );

      if (retryable && attempt < opts.maxRetries - 1) {
        lastError = error;
        continue;
      }

      throw error;
    } catch (error) {
      if (error instanceof HttpClientError && !error.retryable) {
        throw error;
      }

      lastError = error;

      if (attempt < opts.maxRetries - 1 && isRetryable(error)) {
        continue;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new HttpTimeoutError(url, opts.timeoutMs);
      }

      if (error instanceof HttpClientError) {
        throw error;
      }

      throw new HttpClientError(
        error instanceof Error ? error.message : String(error),
        undefined,
        false,
        error
      );
    }
  }

  // Should be unreachable, but handle gracefully
  if (lastError instanceof HttpClientError) throw lastError;
  if (lastError instanceof DOMException && lastError.name === "AbortError") {
    throw new HttpTimeoutError(url, opts.timeoutMs);
  }
  throw new HttpClientError(
    lastError instanceof Error ? lastError.message : String(lastError),
    undefined,
    false,
    lastError
  );
}

/**
 * Single-attempt fetch with AbortController-based timeout.
 * Kept as a low-level building block used internally by httpFetch.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
