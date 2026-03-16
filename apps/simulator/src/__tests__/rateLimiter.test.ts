import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { RateLimiter } from "../middleware/rateLimiter";

vi.mock("../utils/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ─── Helpers ────────────────────────────────────────────────────────

function makeReq(ip: string): Request {
  return {
    ip,
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

function makeRes(): {
  res: Response;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { res: { status } as unknown as Response, status, json };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  afterEach(() => {
    limiter?.cleanup();
    vi.useRealTimers();
  });

  describe("construction", () => {
    it("uses default window and maxRequests when no args given", () => {
      limiter = new RateLimiter();
      const next = vi.fn();
      const { res } = makeRes();
      // Default is 100 req/min — first request should pass
      limiter.middleware()(makeReq("1.2.3.4"), res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("accepts custom window and maxRequests", () => {
      limiter = new RateLimiter(5000, 2);
      const next = vi.fn();
      const { res, status } = makeRes();
      const mw = limiter.middleware();

      mw(makeReq("1.2.3.4"), res, next);
      mw(makeReq("1.2.3.4"), res, next);
      mw(makeReq("1.2.3.4"), res, next); // third should be blocked

      expect(next).toHaveBeenCalledTimes(2);
      expect(status).toHaveBeenCalledWith(429);
    });
  });

  describe("request counting", () => {
    it("allows requests up to maxRequests", () => {
      limiter = new RateLimiter(60000, 3);
      const next = vi.fn();
      const { res } = makeRes();
      const mw = limiter.middleware();

      for (let i = 0; i < 3; i++) {
        mw(makeReq("10.0.0.1"), res, next);
      }
      expect(next).toHaveBeenCalledTimes(3);
    });

    it("blocks the request that exceeds maxRequests", () => {
      limiter = new RateLimiter(60000, 3);
      const next = vi.fn();
      const { res, status } = makeRes();
      const mw = limiter.middleware();

      for (let i = 0; i < 3; i++) {
        mw(makeReq("10.0.0.1"), res, next);
      }
      mw(makeReq("10.0.0.1"), res, next);

      expect(next).toHaveBeenCalledTimes(3);
      expect(status).toHaveBeenCalledWith(429);
    });

    it("tracks different IPs independently", () => {
      limiter = new RateLimiter(60000, 2);
      const next = vi.fn();
      const { res, status } = makeRes();
      const mw = limiter.middleware();

      // IP A hits the limit
      mw(makeReq("1.1.1.1"), res, next);
      mw(makeReq("1.1.1.1"), res, next);
      mw(makeReq("1.1.1.1"), res, next); // blocked

      // IP B still has its own clean window
      mw(makeReq("2.2.2.2"), res, next);
      mw(makeReq("2.2.2.2"), res, next);

      expect(next).toHaveBeenCalledTimes(4); // 2 from A + 2 from B
      expect(status).toHaveBeenCalledTimes(1);
    });
  });

  describe("window reset", () => {
    it("allows new requests after the window expires", () => {
      vi.useFakeTimers();
      limiter = new RateLimiter(1000, 1); // 1 req per second
      const next = vi.fn();
      const { res, status } = makeRes();
      const mw = limiter.middleware();

      mw(makeReq("5.5.5.5"), res, next); // ok
      mw(makeReq("5.5.5.5"), res, next); // blocked

      expect(next).toHaveBeenCalledTimes(1);
      expect(status).toHaveBeenCalledWith(429);

      // Advance time past the window
      vi.advanceTimersByTime(1001);

      mw(makeReq("5.5.5.5"), res, next); // new window — should pass
      expect(next).toHaveBeenCalledTimes(2);
    });
  });

  describe("429 response shape", () => {
    it("sets Retry-After by returning the correct JSON body", () => {
      vi.useFakeTimers();
      limiter = new RateLimiter(10000, 1);
      const mw = limiter.middleware();
      const next = vi.fn();
      const json = vi.fn();
      const status = vi.fn().mockReturnValue({ json });
      const res = { status } as unknown as Response;

      mw(makeReq("9.9.9.9"), res, next); // consumes the single slot
      mw(makeReq("9.9.9.9"), res, next); // triggers 429

      expect(status).toHaveBeenCalledWith(429);
      const body = json.mock.calls[0][0];
      expect(body).toHaveProperty("error");
      expect(body).toHaveProperty("retryAfter");
      expect(typeof body.retryAfter).toBe("number");
      expect(body.retryAfter).toBeGreaterThan(0);
    });
  });

  describe("fallback IP", () => {
    it("uses socket.remoteAddress when req.ip is undefined", () => {
      limiter = new RateLimiter(60000, 1);
      const mw = limiter.middleware();
      const next = vi.fn();
      const { res, status } = makeRes();

      const req = { ip: undefined, socket: { remoteAddress: "7.7.7.7" } } as unknown as Request;
      mw(req, res, next); // ok
      mw(req, res, next); // blocked — same socket IP

      expect(next).toHaveBeenCalledTimes(1);
      expect(status).toHaveBeenCalledWith(429);
    });

    it("uses 'unknown' when both ip and socket are absent", () => {
      limiter = new RateLimiter(60000, 1);
      const mw = limiter.middleware();
      const next = vi.fn();
      const { res, status } = makeRes();

      const req = { ip: undefined, socket: {} } as unknown as Request;
      mw(req, res, next); // ok
      mw(req, res, next); // blocked — both under 'unknown'

      expect(next).toHaveBeenCalledTimes(1);
      expect(status).toHaveBeenCalledWith(429);
    });
  });

  describe("cleanup", () => {
    it("clears the requests map", () => {
      limiter = new RateLimiter(60000, 2);
      const mw = limiter.middleware();
      const next = vi.fn();
      const { res, status } = makeRes();

      // Fill up the limit
      mw(makeReq("3.3.3.3"), res, next);
      mw(makeReq("3.3.3.3"), res, next);
      mw(makeReq("3.3.3.3"), res, next); // blocked
      expect(status).toHaveBeenCalledWith(429);

      limiter.cleanup();

      // After cleanup the internal map is empty — next request starts fresh
      mw(makeReq("3.3.3.3"), res, next);
      expect(next).toHaveBeenCalledTimes(3);
    });

    it("can be called multiple times without error", () => {
      limiter = new RateLimiter();
      expect(() => {
        limiter.cleanup();
        limiter.cleanup();
      }).not.toThrow();
    });
  });

  describe("auto-cleanup of expired entries", () => {
    it("removes expired entries on the internal interval", () => {
      vi.useFakeTimers();
      limiter = new RateLimiter(500, 1);
      const mw = limiter.middleware();
      const next = vi.fn();
      const { res } = makeRes();

      mw(makeReq("4.4.4.4"), res, next); // consumes the slot, sets reset at +500ms

      // Advance past the entry's own window AND past the 60 s cleanup interval
      vi.advanceTimersByTime(61000);

      // Requesting again now creates a brand-new entry — should be allowed
      mw(makeReq("4.4.4.4"), res, next);
      expect(next).toHaveBeenCalledTimes(2);
    });
  });
});
