import type { Request, Response, NextFunction } from "express";
import logger from "../utils/logger";

/** Sentinel error used internally to detect a handler timeout in the race. */
class HandlerTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Handler timed out after ${timeoutMs}ms`);
    this.name = "HandlerTimeoutError";
  }
}

export interface AsyncHandlerOptions {
  /**
   * Optional handler timeout in milliseconds. When set (> 0), the handler
   * promise is raced against a timer; on timeout the request is answered
   * with 503 and a clear error message. Default: no timeout.
   */
  timeoutMs?: number;
}

/**
 * Error handling wrapper for async route handlers.
 * Catches rejected promises and forwards them to Express error middleware.
 *
 * Optionally enforces a timeout: pass `{ timeoutMs }` to respond 503 when the
 * handler does not settle in time. The handler keeps running in the
 * background; a late rejection is logged (warn) but no longer affects the
 * already-answered request.
 */
export const asyncHandler = (
  fn: (req: Request, res: Response) => Promise<void>,
  options: AsyncHandlerOptions = {}
) => {
  const { timeoutMs } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const handler = Promise.resolve(fn(req, res));

    if (!timeoutMs || timeoutMs <= 0) {
      handler.catch(next);
      return;
    }

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new HandlerTimeoutError(timeoutMs)), timeoutMs);
    });

    // Prevent an unhandled rejection if the handler rejects after the timeout
    // won — but don't hide the failure: log it so late errors stay observable.
    // (When the handler rejects BEFORE the timeout, the race below forwards
    // the error to next(), so this callback stays silent.)
    let timedOut = false;
    handler.catch((err: unknown) => {
      if (timedOut) {
        logger.warn(`${req.method} ${req.path} failed after timing out (${timeoutMs}ms): ${err}`);
      }
    });

    Promise.race([handler, timeout])
      .then(() => clearTimeout(timer))
      .catch((err: unknown) => {
        clearTimeout(timer);
        if (err instanceof HandlerTimeoutError) {
          timedOut = true;
          logger.warn(`${req.method} ${req.path} timed out after ${timeoutMs}ms`);
          if (!res.headersSent) {
            res.status(503).json({
              error: `Request timed out after ${timeoutMs}ms`,
              requestId: res.locals.requestId as string | undefined,
            });
          }
          return;
        }
        next(err);
      });
  };
};
