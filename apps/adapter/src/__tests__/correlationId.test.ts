import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock logger before importing the middleware
vi.mock("../utils/logger", () => ({
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

import { correlationIdMiddleware } from "../middleware/correlationId";
import logger from "../utils/logger";

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

describe("correlationIdMiddleware (adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should generate a UUID when no x-request-id header is provided", async () => {
    const app = createApp();
    const res = await request(app).get("/test");
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBeDefined();
    expect(typeof res.body.requestId).toBe("string");
    // UUID v4 pattern
    expect(res.body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("should use the x-request-id header value when provided", async () => {
    const app = createApp();
    const res = await request(app).get("/test").set("x-request-id", "my-trace-id");
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe("my-trace-id");
  });

  it("should create a child logger with the requestId", async () => {
    const app = createApp();
    await request(app).get("/test");
    expect(logger.child).toHaveBeenCalledWith({ requestId: expect.any(String) });
  });

  it("should attach logger to res.locals", async () => {
    const app = createApp();
    const res = await request(app).get("/test");
    expect(res.body.hasLogger).toBe(true);
  });

  it("should log 'request start' on incoming request", async () => {
    const app = createApp();
    await request(app).get("/test");

    const childLogger = (logger.child as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(childLogger.info).toHaveBeenCalledWith(
      { method: "GET", path: "/test" },
      "request start"
    );
  });

  it("should log 'request finish' with status and duration on response", async () => {
    const app = createApp();
    await request(app).get("/test");

    const childLogger = (logger.child as ReturnType<typeof vi.fn>).mock.results[0].value;
    const infoCalls = childLogger.info.mock.calls;
    const finishCall = infoCalls.find((call: any[]) => call[1] === "request finish");
    expect(finishCall).toBeDefined();
    expect(finishCall![0].status).toBe(200);
    expect(finishCall![0].duration).toBeGreaterThanOrEqual(0);
    expect(finishCall![0].method).toBe("GET");
    expect(finishCall![0].path).toBe("/test");
  });

  it("should call next() to pass control to the next middleware", async () => {
    const app = createApp();
    const res = await request(app).get("/test");
    // If next() wasn't called, we wouldn't get a response
    expect(res.status).toBe(200);
  });
});
