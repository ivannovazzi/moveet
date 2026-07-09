import { createCorrelationIdMiddleware } from "@moveet/server-kit";
import logger from "../utils/logger";

/**
 * Correlation-id middleware bound to the simulator's logger. Thin wrapper over
 * the shared `@moveet/server-kit` middleware: reads/generates `x-request-id`,
 * stores it on `res.locals.requestId`, echoes it on the response, and attaches a
 * per-request child logger to `res.locals.logger`.
 */
export const correlationIdMiddleware = createCorrelationIdMiddleware({
  logger,
});

export default correlationIdMiddleware;
