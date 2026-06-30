import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// The middleware now wraps the shared @moveet/server-kit factory, bound to the
// simulator's logger. We mock the logger module (whose default export is the
// root logger) and assert through the per-request CHILD logger the shared
// middleware mints. The x-request-id flow and res.locals contract are unchanged.
const childLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
};

vi.mock("../../utils/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    child: vi.fn(() => childLogger),
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
    (logger.child as ReturnType<typeof vi.fn>).mockReturnValue(childLogger);
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

  it("should echo the requestId on the response header", async () => {
    const app = createApp();
    const res = await request(app).get("/test").set("x-request-id", "custom-id-123");
    expect(res.headers["x-request-id"]).toBe("custom-id-123");
  });

  it("should create a child logger with requestId", async () => {
    const app = createApp();
    const res = await request(app).get("/test");
    expect(res.status).toBe(200);
    expect(res.body.hasLogger).toBe(true);
    expect(logger.child).toHaveBeenCalledWith({ requestId: expect.any(String) });
  });

  it("should log request start", async () => {
    const app = createApp();
    await request(app).get("/test");
    expect(childLogger.info).toHaveBeenCalledWith(
      { method: "GET", path: "/test" },
      "request start"
    );
  });

  it("should log request finish with status and duration", async () => {
    const app = createApp();
    await request(app).get("/test");

    const finishCall = childLogger.info.mock.calls.find((call) => call[1] === "request finish");
    expect(finishCall).toBeDefined();
    expect(finishCall![0].status).toBe(200);
    expect(finishCall![0].duration).toBeGreaterThanOrEqual(0);
  });
});
