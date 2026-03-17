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
