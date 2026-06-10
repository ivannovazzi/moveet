import type { Request, Response, NextFunction } from "express";
import { createLogger } from "../utils/logger";

const logger = createLogger("errorHandler");

/**
 * Final Express error-handling middleware: logs the error (via the request's
 * correlation-id child logger when available) and returns structured JSON
 * instead of Express's default HTML error page. Must be registered last.
 */
export function errorHandlerMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  const log = res.locals.logger ?? logger;
  log.error({ err }, "Unhandled error in request handler");

  if (res.headersSent) {
    next(err);
    return;
  }

  // Respect framework-supplied HTTP statuses (e.g. body-parser's 400 on
  // malformed JSON); anything else is an internal error.
  const status =
    err != null &&
    typeof err === "object" &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number" &&
    (err as { status: number }).status >= 400 &&
    (err as { status: number }).status < 600
      ? (err as { status: number }).status
      : 500;

  // Never leak internal error details (broker addresses, file paths, …) to
  // clients on 5xx; the requestId lets operators correlate with the logs.
  // 4xx messages (e.g. body-parser's malformed-JSON detail) are safe to expose.
  const message =
    status >= 500 ? "Internal server error" : err instanceof Error ? err.message : String(err);

  res.status(status).json({
    error: status >= 500 ? "Internal server error" : "Bad request",
    message,
    ...(res.locals.requestId ? { requestId: res.locals.requestId } : {}),
  });
}
