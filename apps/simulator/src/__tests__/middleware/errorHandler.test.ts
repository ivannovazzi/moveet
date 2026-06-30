import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler } from "../../middleware/errorHandler";
import logger from "../../utils/logger";

// The handler now wraps the shared @moveet/server-kit error handler, bound to
// the simulator's logger as the fallback. When a request has no
// res.locals.logger, the shared handler logs via this fallback.
vi.mock("../../utils/logger", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function createApp() {
  const app = express();
  app.use(express.json());
  // Simulate the correlation-ID middleware (requestId only — no child logger,
  // so the shared handler falls back to the injected simulator logger).
  app.use((_req, res, next) => {
    res.locals.requestId = "test-request-id";
    next();
  });
  app.get("/boom", () => {
    throw new Error("kaboom");
  });
  app.get("/client-error", () => {
    throw Object.assign(new Error("missing widget id"), { status: 422 });
  });
  app.get("/ok", (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

describe("errorHandler middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should respond 500 with the correlation ID in the body", async () => {
    const res = await request(createApp()).get("/boom");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: "Internal server error",
      message: "Internal server error",
      requestId: "test-request-id",
    });
  });

  it("should not leak internal error details on 5xx", async () => {
    const res = await request(createApp()).get("/boom");
    expect(JSON.stringify(res.body)).not.toContain("kaboom");
  });

  it("should log the error via the fallback logger when no request logger is set", async () => {
    await request(createApp()).get("/boom");

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [context, message] = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(context).toMatchObject({ err: expect.any(Error) });
    expect(message).toBe("Unhandled error in request handler");
  });

  it("should expose the error message to clients for 4xx errors", async () => {
    const res = await request(createApp()).get("/client-error");
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Bad request");
    expect(res.body.message).toBe("missing widget id");
  });

  it("should not affect successful requests", async () => {
    const res = await request(createApp()).get("/ok");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
