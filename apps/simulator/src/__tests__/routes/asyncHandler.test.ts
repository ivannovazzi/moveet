import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { asyncHandler } from "../../routes/helpers";
import logger from "../../utils/logger";

// Mock logger to suppress output
vi.mock("../../utils/logger", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function createApp(handler: express.RequestHandler) {
  const app = express();
  app.get("/test", handler);
  // Error middleware mirroring the global handler
  app.use(
    (
      _err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ): void => {
      res.status(500).json({ error: "Internal server error" });
    }
  );
  return app;
}

describe("asyncHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should pass through a successful handler", async () => {
    const app = createApp(
      asyncHandler(async (_req, res) => {
        res.json({ ok: true });
      })
    );
    const res = await request(app).get("/test");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("should forward handler rejections to error middleware", async () => {
    const app = createApp(
      asyncHandler(async () => {
        throw new Error("boom");
      })
    );
    const res = await request(app).get("/test");
    expect(res.status).toBe(500);
  });

  it("should not time out by default (no timeoutMs)", async () => {
    const app = createApp(
      asyncHandler(async (_req, res) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        res.json({ ok: true });
      })
    );
    const res = await request(app).get("/test");
    expect(res.status).toBe(200);
  });

  it("should respond 503 when the handler exceeds timeoutMs", async () => {
    const app = createApp(
      asyncHandler(
        async (_req, res) => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          if (!res.headersSent) res.json({ ok: true });
        },
        { timeoutMs: 20 }
      )
    );
    const res = await request(app).get("/test");
    expect(res.status).toBe(503);
    expect(res.body.error).toContain("timed out after 20ms");
  });

  it("should not respond 503 when the handler finishes within timeoutMs", async () => {
    const app = createApp(
      asyncHandler(
        async (_req, res) => {
          res.json({ ok: true });
        },
        { timeoutMs: 1000 }
      )
    );
    const res = await request(app).get("/test");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("should still forward errors to error middleware when timeoutMs is set", async () => {
    const app = createApp(
      asyncHandler(
        async () => {
          throw new Error("boom");
        },
        { timeoutMs: 1000 }
      )
    );
    const res = await request(app).get("/test");
    expect(res.status).toBe(500);
  });

  it("should log (not swallow) a handler rejection that occurs after the timeout", async () => {
    let rejectLater: (err: Error) => void = () => {};
    const app = createApp(
      asyncHandler(
        () =>
          new Promise<void>((_, reject) => {
            rejectLater = reject;
          }),
        { timeoutMs: 20 }
      )
    );

    const res = await request(app).get("/test");
    expect(res.status).toBe(503);

    // Late rejection after the 503 must not crash the process, but it must
    // still be observable in the logs.
    rejectLater(new Error("late failure"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("late failure"));
  });

  it("should not log handler rejections that happen before the timeout", async () => {
    const app = createApp(
      asyncHandler(
        async () => {
          throw new Error("early failure");
        },
        { timeoutMs: 1000 }
      )
    );

    const res = await request(app).get("/test");
    expect(res.status).toBe(500); // forwarded to error middleware
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should include the request ID in the 503 timeout body when set", async () => {
    const app = express();
    app.use((_req, res, next) => {
      res.locals.requestId = "test-request-id";
      next();
    });
    app.get(
      "/test",
      asyncHandler(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
        },
        { timeoutMs: 20 }
      )
    );

    const res = await request(app).get("/test");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: "Request timed out after 20ms",
      requestId: "test-request-id",
    });
  });
});
