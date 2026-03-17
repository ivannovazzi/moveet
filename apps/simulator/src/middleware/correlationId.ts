import type { Request, Response, NextFunction } from "express";
import logger from "../utils/logger";

export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId =
    (req.headers["x-request-id"] as string | undefined) ??
    crypto.randomUUID();

  res.locals.requestId = requestId;
  res.locals.logger = logger.child({ requestId });

  const startTime = Date.now();

  logger.info({ method: req.method, path: req.path, requestId });

  res.on("finish", () => {
    const duration = Date.now() - startTime;
    logger.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      requestId,
    });
  });

  next();
}

export default correlationIdMiddleware;
