import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createErrorHandler } from "../errorHandler";

const localsLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
const fallbackLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

function createApp(opts: { withLocalsLogger?: boolean } = {}) {
  const { withLocalsLogger = true } = opts;
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.requestId = "test-request-id";
    if (withLocalsLogger) res.locals.logger = localsLogger;
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
  app.get("/string-throw", () => {
    // Non-object throw: the status discriminator must fall through to 500.
    throw "not an error object";
  });
  app.get("/status-too-high", () => {
    // status >= 600 is out of the 4xx-5xx window and must fall through to 500.
    throw Object.assign(new Error("teapot from space"), { status: 600 });
  });
  app.get("/status-too-low", () => {
    // status < 400 is not a client/server error and must fall through to 500.
    throw Object.assign(new Error("redirect-ish"), { status: 302 });
  });
  app.get("/ok", (_req, res) => {
    res.json({ ok: true });
  });
  app.use(
    createErrorHandler({
      logger: fallbackLogger as unknown as Parameters<typeof createErrorHandler>[0]["logger"],
    })
  );
  return app;
}

describe("createErrorHandler", () => {
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
    expect(JSON.stringify(res.body)).not.toContain("sync kaboom");
  });

  it("logs the error via the request-scoped logger when present", async () => {
    await request(createApp()).get("/sync-boom");
    expect(localsLogger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Unhandled error in request handler"
    );
    expect(fallbackLogger.error).not.toHaveBeenCalled();
  });

  it("falls back to the injected logger when res.locals has none", async () => {
    await request(createApp({ withLocalsLogger: false })).get("/sync-boom");
    expect(fallbackLogger.error).toHaveBeenCalledWith(
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

  it("falls through to 500 for non-object throws", async () => {
    const res = await request(createApp()).get("/string-throw");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Internal server error");
  });

  it("falls through to 500 when a supplied status is out of the 4xx-5xx window", async () => {
    const high = await request(createApp()).get("/status-too-high");
    expect(high.status).toBe(500);
    const low = await request(createApp()).get("/status-too-low");
    expect(low.status).toBe(500);
  });

  it("delegates to next() without writing a body when headers are already sent", () => {
    const handler = createErrorHandler({
      logger: fallbackLogger as unknown as Parameters<typeof createErrorHandler>[0]["logger"],
    });
    const next = vi.fn();
    const status = vi.fn();
    const json = vi.fn();
    const res = {
      headersSent: true,
      locals: { logger: localsLogger },
      status,
      json,
    } as unknown as Parameters<typeof handler>[2];
    const err = new Error("boom after headers");

    handler(err, {} as unknown as Parameters<typeof handler>[1], res, next);

    expect(localsLogger.error).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(err);
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });
});
