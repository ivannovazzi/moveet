// ─── @moveet/server-kit ─────────────────────────────────────────────
// Shared server runtime infrastructure for the Moveet monorepo: a pino logger
// factory with consistent secret redaction, Express correlation-id and
// error-handling middleware, and a retrying HTTP client for Node services.

export {
  createLogger,
  createModuleLoggerFactory,
  DEFAULT_REDACT_PATHS,
  type CreateLoggerOptions,
  type Logger,
} from "./logger";

export {
  createCorrelationIdMiddleware,
  REQUEST_ID_HEADER,
  type CorrelationIdOptions,
} from "./correlationId";

export { createErrorHandler, type ErrorHandlerOptions } from "./errorHandler";

export {
  httpFetch,
  HttpClientError,
  HttpTimeoutError,
  type HttpClientOptions,
} from "./httpClient";
