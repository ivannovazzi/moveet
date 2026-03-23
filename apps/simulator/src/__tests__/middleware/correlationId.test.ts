import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock logger before importing the middleware
vi.mock("../../utils/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

import { correlationIdMiddleware } from "../../middleware/correlationId";
import logger from "../../utils/logger";

function createApp() {
  const app = express();
  app.use(correlationIdMiddleware);
  app.get("/test", (_req, res) => {
    res.json({
      requestId: res.locals.requestId,
      hasLogger: !!res.locals.logger,
    });
  });
  return app;
}

describe("correlationIdMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should generate a requestId when x-request-id header is not provided", async () => {
    const app = createApp();
    const res = await request(app).get("/test");
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBeDefined();
    expect(typeof res.body.requestId).toBe("string");
    expect(res.body.requestId.length).toBeGreaterThan(0);
  });

  it("should use x-request-id header when provided", async () => {
    const app = createApp();
    const res = await request(app).get("/test").set("x-request-id", "custom-id-123");
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe("custom-id-123");
  });

  it("should create a child logger with requestId", async () => {
    const app = createApp();
    const res = await request(app).get("/test");
    expect(res.status).toBe(200);
    expect(res.body.hasLogger).toBe(true);
  });

  it("should log request start", async () => {
    const app = createApp();
    await request(app).get("/test");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/test",
        requestId: expect.any(String),
      })
    );
  });

  it("should log request finish with status and duration", async () => {
    const app = createApp();
    await request(app).get("/test");

    // The finish log is called on response close
    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const finishCall = infoCalls.find(
      (call) => call[0]?.status !== undefined && call[0]?.duration !== undefined
    );
    expect(finishCall).toBeDefined();
    expect(finishCall![0].status).toBe(200);
    expect(finishCall![0].duration).toBeGreaterThanOrEqual(0);
  });
});
