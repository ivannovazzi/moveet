import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandlerMiddleware } from "../middleware/errorHandler";

const localsLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.requestId = "test-request-id";
    res.locals.logger = localsLogger;
    next();
  });
  app.get("/sync-boom", () => {
    throw new Error("sync kaboom");
  });
  app.get("/async-boom", async () => {
    throw new Error("async kaboom");
  });
  app.get("/client-error", () => {
    throw Object.assign(new Error("missing widget id"), { status: 422 });
  });
  app.get("/ok", (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandlerMiddleware);
  return app;
}

describe("errorHandlerMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns structured JSON with requestId for synchronous handler throws", async () => {
    const res = await request(createApp()).get("/sync-boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: "Internal server error",
      message: "Internal server error",
      requestId: "test-request-id",
    });
  });

  it("returns structured JSON for rejected async handlers (Express 5)", async () => {
    const res = await request(createApp()).get("/async-boom");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Internal server error");
    expect(res.body.message).toBe("Internal server error");
  });

  it("does not leak internal error details to clients on 5xx", async () => {
    const res = await request(createApp()).get("/sync-boom");
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("sync kaboom");
  });

  it("logs the error via the request-scoped logger", async () => {
    await request(createApp()).get("/sync-boom");
    expect(localsLogger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Unhandled error in request handler"
    );
  });

  it("exposes the error message to clients for 4xx errors", async () => {
    const res = await request(createApp()).get("/client-error");
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Bad request");
    expect(res.body.message).toBe("missing widget id");
  });

  it("respects framework-supplied statuses (body-parser 400 on malformed JSON)", async () => {
    const res = await request(createApp())
      .post("/ok")
      .set("content-type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Bad request");
  });

  it("does not affect successful requests", async () => {
    const res = await request(createApp()).get("/ok");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
