import { describe, it, expect } from "vitest";
import express from "express";
import cors from "cors";
import request from "supertest";

function createAppWithCors(origins: string[] | "*") {
  const app = express();
  app.use(cors({ origin: origins === "*" ? "*" : origins }));
  app.get("/test", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("CORS middleware", () => {
  it("allows requests from a listed origin", async () => {
    const app = createAppWithCors(["http://localhost:5010", "http://localhost:5012"]);

    const res = await request(app).get("/test").set("Origin", "http://localhost:5010");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5010");
  });

  it("does not set allow-origin header for unlisted origins", async () => {
    const app = createAppWithCors(["http://localhost:5010"]);

    const res = await request(app).get("/test").set("Origin", "http://evil.com");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows any origin when wildcard is configured", async () => {
    const app = createAppWithCors("*");

    const res = await request(app).get("/test").set("Origin", "http://anything.example.com");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("responds to preflight OPTIONS requests for allowed origins", async () => {
    const app = createAppWithCors(["http://localhost:5012"]);

    const res = await request(app)
      .options("/test")
      .set("Origin", "http://localhost:5012")
      .set("Access-Control-Request-Method", "GET");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5012");
  });

  it("does not set allow-origin on preflight for unlisted origins", async () => {
    const app = createAppWithCors(["http://localhost:5010"]);

    const res = await request(app)
      .options("/test")
      .set("Origin", "http://evil.com")
      .set("Access-Control-Request-Method", "GET");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
