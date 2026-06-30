import { createErrorHandler } from "@moveet/server-kit";
import logger from "../utils/logger";

/**
 * Global Express error handler (must be registered last).
 *
 * Thin wrapper over the shared `@moveet/server-kit` error handler, bound to the
 * simulator's logger. The shared handler logs via the request-scoped child
 * logger when present, respects framework-supplied 4xx statuses, and never
 * leaks internal 5xx error details to clients (only the requestId is echoed).
 */
export const errorHandler = createErrorHandler({ logger });

export default errorHandler;
