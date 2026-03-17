import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import logger from "../utils/logger";

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();

  res.locals.requestId = requestId;
  res.locals.logger = logger.child({ requestId });

  const start = Date.now();
  res.locals.logger.info({ method: req.method, path: req.path }, "request start");

  res.on("finish", () => {
    const duration = Date.now() - start;
    res.locals.logger.info(
      { method: req.method, path: req.path, status: res.statusCode, duration },
      "request finish"
    );
  });

  next();
}
