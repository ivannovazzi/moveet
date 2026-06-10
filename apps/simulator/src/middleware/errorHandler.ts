import type { Request, Response, NextFunction } from "express";
import logger from "../utils/logger";

/**
 * Global Express error handler.
 *
 * Logs the failing request's method, path, and correlation request ID
 * (set by correlationIdMiddleware), including the stack trace outside
 * production. The correlation ID is echoed in the response body so
 * clients can reference it when reporting errors.
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const requestId = res.locals.requestId as string | undefined;
  const isDev = process.env.NODE_ENV !== "production";

  logger.error(
    {
      method: req.method,
      path: req.path,
      requestId,
      ...(isDev && err.stack ? { stack: err.stack } : {}),
    },
    `Unhandled error: ${err.message}`
  );

  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error", requestId });
}

export default errorHandler;
