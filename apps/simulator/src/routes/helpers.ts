import type { Request, Response, NextFunction } from "express";

/**
 * Error handling wrapper for async route handlers.
 * Catches rejected promises and forwards them to Express error middleware.
 */
export const asyncHandler = (fn: (req: Request, res: Response) => Promise<void>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
};

/**
 * Validate that body is a [longitude, latitude] coordinate pair.
 */
export function validateCoordinates(body: unknown): body is [number, number] {
  return (
    Array.isArray(body) &&
    body.length === 2 &&
    typeof body[0] === "number" &&
    typeof body[1] === "number" &&
    !isNaN(body[0]) &&
    !isNaN(body[1])
  );
}

/**
 * Validate that body contains a non-empty query string.
 */
export function validateSearchQuery(body: unknown): body is { query: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    "query" in body &&
    typeof (body as { query: unknown }).query === "string" &&
    (body as { query: string }).query.length > 0
  );
}
