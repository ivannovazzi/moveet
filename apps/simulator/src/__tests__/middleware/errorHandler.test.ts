import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler } from "../../middleware/errorHandler";
import logger from "../../utils/logger";

// Mock logger to capture log calls
vi.mock("../../utils/logger", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function createApp() {
  const app = express();
  // Simulate the correlation-ID middleware
  app.use((_req, res, next) => {
    res.locals.requestId = "test-request-id";
    next();
  });
  app.get("/boom", () => {
    throw new Error("kaboom");
  });
  app.use(errorHandler);
  return app;
}

describe("errorHandler middleware", () => {
  let origNodeEnv: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    origNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    // Assigning undefined would coerce to the string "undefined"; delete instead.
    if (origNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = origNodeEnv;
    }
  });

  it("should respond 500 with the correlation ID in the body", async () => {
    const res = await request(createApp()).get("/boom");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error", requestId: "test-request-id" });
  });

  it("should log method, path, and request ID", async () => {
    await request(createApp()).get("/boom");

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [context, message] = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(context).toMatchObject({
      method: "GET",
      path: "/boom",
      requestId: "test-request-id",
    });
    expect(message).toBe("Unhandled error: kaboom");
  });

  it("should include the stack trace outside production", async () => {
    process.env.NODE_ENV = "development";
    await request(createApp()).get("/boom");

    const [context] = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(context.stack).toContain("kaboom");
  });

  it("should omit the stack trace in production", async () => {
    process.env.NODE_ENV = "production";
    await request(createApp()).get("/boom");

    const [context] = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(context).not.toHaveProperty("stack");
  });
});
