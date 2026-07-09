import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createCorrelationIdMiddleware, REQUEST_ID_HEADER } from "../correlationId";

const childLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
};

const rootLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  child: vi.fn().mockReturnValue(childLogger),
} as unknown as Parameters<typeof createCorrelationIdMiddleware>[0]["logger"];

function createApp() {
  const app = express();
  app.use(createCorrelationIdMiddleware({ logger: rootLogger }));
  app.get("/test", (_req, res) => {
    res.json({
      requestId: res.locals.requestId,
      hasLogger: !!res.locals.logger,
    });
  });
  return app;
}

describe("createCorrelationIdMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (rootLogger.child as unknown as ReturnType<typeof vi.fn>).mockReturnValue(childLogger);
  });

  it("generates a UUID v4 when no x-request-id header is provided", async () => {
    const res = await request(createApp()).get("/test");
    expect(res.status).toBe(200);
    expect(res.body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("uses the inbound x-request-id header when provided", async () => {
    const res = await request(createApp()).get("/test").set(REQUEST_ID_HEADER, "my-trace-id");
    expect(res.body.requestId).toBe("my-trace-id");
  });

  it("echoes the requestId back on the response header", async () => {
    const res = await request(createApp()).get("/test").set(REQUEST_ID_HEADER, "echo-me");
    expect(res.headers[REQUEST_ID_HEADER]).toBe("echo-me");
  });

  it("creates a child logger bound to the requestId and attaches it to res.locals", async () => {
    const res = await request(createApp()).get("/test");
    expect(rootLogger.child).toHaveBeenCalledWith({
      requestId: expect.any(String),
    });
    expect(res.body.hasLogger).toBe(true);
  });

  it("logs 'request start' via the request-scoped child logger", async () => {
    await request(createApp()).get("/test");
    expect(childLogger.info).toHaveBeenCalledWith(
      { method: "GET", path: "/test" },
      "request start"
    );
  });

  it("logs 'request finish' with status and duration on response", async () => {
    await request(createApp()).get("/test");
    const finishCall = childLogger.info.mock.calls.find((c) => c[1] === "request finish");
    expect(finishCall).toBeDefined();
    expect(finishCall![0].status).toBe(200);
    expect(finishCall![0].duration).toBeGreaterThanOrEqual(0);
    expect(finishCall![0].method).toBe("GET");
    expect(finishCall![0].path).toBe("/test");
  });
});
