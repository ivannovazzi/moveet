import type { Request, Response, NextFunction } from "express";
import { observeHttpRequest } from "../metrics";

/**
 * Lightweight Express middleware that records request duration into the
 * HTTP duration histogram, labelled by method, route, and status.
 *
 * The route label prefers the matched route pattern (`req.route.path`, e.g.
 * `/vehicles/:id`) so per-id paths collapse into a single low-cardinality
 * series; it falls back to the raw path when no route matched (e.g. 404s).
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    // baseUrl + route.path reconstructs the registered pattern for routers
    // mounted at the app root; fall back to req.path when no route matched.
    const routePattern =
      req.route?.path !== undefined ? `${req.baseUrl}${req.route.path}` : req.path;
    observeHttpRequest(req.method, routePattern, res.statusCode, durationSeconds);
  });

  next();
}

export default metricsMiddleware;
