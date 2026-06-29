/**
 * Re-export of the shared retrying HTTP client from `@moveet/server-kit`.
 *
 * The implementation moved to the shared package (architecture review roadmap
 * #6 — de-duplicated server runtime infra). This thin re-export is kept because
 * many adapter modules and their tests import (and `vi.mock`) this local path;
 * the retry/timeout/backoff semantics are unchanged.
 */
export {
  httpFetch,
  HttpClientError,
  HttpTimeoutError,
  type HttpClientOptions,
} from "@moveet/server-kit";
