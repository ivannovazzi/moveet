import type { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import type { Logger } from "pino";

export interface ErrorHandlerOptions {
  /**
   * Fallback logger used when the request has no `res.locals.logger`
   * (i.e. the correlation-id middleware did not run for this request).
   */
  logger: Logger;
}

/**
 * Build the final Express error-handling middleware (must be registered last).
 *
 * This is the stronger of the two previous per-app handlers, parameterized by
 * an injected fallback logger:
 * - Logs the error via the request-scoped child logger when available, else the
 *   injected fallback logger.
 * - Respects framework-supplied HTTP statuses (e.g. body-parser's 400 on
 *   malformed JSON); anything else is treated as a 500.
 * - Never leaks internal error details to clients on 5xx (only the requestId is
 *   returned so operators can correlate with the logs); 4xx messages are
 *   considered safe to expose.
 */
export function createErrorHandler(options: ErrorHandlerOptions): ErrorRequestHandler {
  const { logger } = options;

  return function errorHandler(
    err: unknown,
    _req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const log = (res.locals.logger as Logger | undefined) ?? logger;
    log.error({ err }, "Unhandled error in request handler");

    if (res.headersSent) {
      next(err);
      return;
    }

    const status =
      err != null &&
      typeof err === "object" &&
      "status" in err &&
      typeof (err as { status: unknown }).status === "number" &&
      (err as { status: number }).status >= 400 &&
      (err as { status: number }).status < 600
        ? (err as { status: number }).status
        : 500;

    const message =
      status >= 500 ? "Internal server error" : err instanceof Error ? err.message : String(err);

    res.status(status).json({
      error: status >= 500 ? "Internal server error" : "Bad request",
      message,
      ...(res.locals.requestId ? { requestId: res.locals.requestId } : {}),
    });
  };
}
