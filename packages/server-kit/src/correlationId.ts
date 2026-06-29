import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { Logger } from "pino";

/** The correlation header both Moveet services read and propagate. */
export const REQUEST_ID_HEADER = "x-request-id";

export interface CorrelationIdOptions {
  /**
   * Root logger used to mint a per-request child logger. The child (bound to
   * `{ requestId }`) is stored on `res.locals.logger` and used for the
   * request-start / request-finish lines.
   */
  logger: Logger;
}

/**
 * Express middleware that establishes a per-request correlation id.
 *
 * Behavior (the consolidated superset of the two previous per-app copies):
 * - Reads an inbound `x-request-id` header, or generates a UUID v4 when absent.
 * - Stores it on `res.locals.requestId` (the value both apps' downstream
 *   propagation and metrics wiring read).
 * - Echoes it back on the response `x-request-id` header so callers can
 *   correlate (additive: neither old copy did this, the flow is unaffected).
 * - Binds a child logger `{ requestId }` to `res.locals.logger`.
 * - Logs `"request start"` and, on `finish`, `"request finish"` with status +
 *   duration, via the request-scoped child logger.
 */
export function createCorrelationIdMiddleware(options: CorrelationIdOptions): RequestHandler {
  const { logger } = options;

  return function correlationIdMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const requestId = (req.headers[REQUEST_ID_HEADER] as string | undefined) ?? randomUUID();

    res.locals.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const child = logger.child({ requestId });
    res.locals.logger = child;

    const start = Date.now();
    child.info({ method: req.method, path: req.path }, "request start");

    res.on("finish", () => {
      const duration = Date.now() - start;
      child.info(
        { method: req.method, path: req.path, status: res.statusCode, duration },
        "request finish"
      );
    });

    next();
  };
}
