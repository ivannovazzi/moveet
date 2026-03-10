import type { Request, Response, NextFunction } from "express";
import logger from "../utils/logger";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * Simple in-memory rate limiter middleware
 * Limits requests per IP address within a time window
 */
export class RateLimiter {
  private requests: Map<string, RateLimitEntry> = new Map();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private cleanupInterval: NodeJS.Timeout;

  constructor(windowMs: number = 60000, maxRequests: number = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;

    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [ip, entry] of this.requests.entries()) {
        if (now > entry.resetTime) {
          this.requests.delete(ip);
        }
      }
    }, 60000);
  }

  public middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const now = Date.now();

      let entry = this.requests.get(ip);

      if (!entry || now > entry.resetTime) {
        // Create new entry or reset expired entry
        entry = {
          count: 1,
          resetTime: now + this.windowMs,
        };
        this.requests.set(ip, entry);
        next();
        return;
      }

      if (entry.count >= this.maxRequests) {
        // Rate limit exceeded
        const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
        logger.warn(`Rate limit exceeded for IP ${ip}`);
        res.status(429).json({
          error: "Too many requests, please try again later",
          retryAfter,
        });
        return;
      }

      // Increment count and allow request
      entry.count++;
      next();
    };
  }

  public cleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.requests.clear();
  }
}

// Create rate limiter instances
export const generalRateLimiter = new RateLimiter(60000, 100); // 100 requests per minute
export const expensiveRateLimiter = new RateLimiter(60000, 20); // 20 requests per minute for expensive operations
