import type { Request, Response, NextFunction } from "express";
import cluster from "node:cluster";
import logger from "../utils/logger";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/** One-time flag so the multi-process warning is only logged once per process. */
let warnedAboutClustering = false;

/**
 * Simple in-memory rate limiter middleware
 * Limits requests per IP address within a time window
 *
 * LIMITATION: counters are kept in process memory, so limits are enforced
 * per process. When running multiple instances (cluster mode, pm2, multiple
 * containers behind one load balancer), each process tracks its own counts
 * and the effective limit is N × maxRequests. A shared store (e.g. Redis)
 * would be required for cluster-wide enforcement — intentionally not added
 * here to keep the simulator dependency-free.
 */
export class RateLimiter {
  private requests: Map<string, RateLimitEntry> = new Map();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private cleanupInterval: NodeJS.Timeout;

  constructor(windowMs: number = 60000, maxRequests: number = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;

    // One-time startup warning when running in a multi-process setup where
    // per-process counters silently weaken the configured limits.
    if (!warnedAboutClustering && (cluster.isWorker || process.env.NODE_APP_INSTANCE)) {
      warnedAboutClustering = true;
      logger.warn(
        "In-memory rate limiter detected a clustered/multi-process environment: limits are enforced per process, not globally"
      );
    }

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
export const incidentRateLimiter = new RateLimiter(60000, 100); // 100 incident creations per minute
