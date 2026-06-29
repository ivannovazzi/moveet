import { createErrorHandler } from "@moveet/server-kit";
import { createLogger } from "../utils/logger";

const logger = createLogger("errorHandler");

/**
 * Final Express error-handling middleware (must be registered last). Thin
 * wrapper over the shared `@moveet/server-kit` error handler, bound to the
 * adapter's logger. Logs via the request's correlation-id child logger when
 * available, returns structured JSON, respects framework-supplied statuses, and
 * never leaks internal 5xx details to clients.
 */
export const errorHandlerMiddleware = createErrorHandler({ logger });

export default errorHandlerMiddleware;
