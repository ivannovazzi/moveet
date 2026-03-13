import { describe, it, expect } from "vitest";
import express from "express";
import compression from "compression";
import request from "supertest";

function createAppWithCompression() {
  const app = express();
  app.use(compression());

  app.get("/large-json", (_req, res) => {
    // Generate a payload well above the 1KB default threshold
    const data = Array.from({ length: 200 }, (_, i) => ({
      id: i,
      name: `Vehicle ${i}`,
      latitude: -1.28 + Math.random() * 0.1,
      longitude: 36.81 + Math.random() * 0.1,
      status: "active",
      description: "A vehicle moving along the road network in the simulation",
    }));
    res.json(data);
  });

  app.get("/small-json", (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}

describe("compression middleware", () => {
  it("compresses large JSON responses when client accepts gzip", async () => {
    const app = createAppWithCompression();

    const res = await request(app)
      .get("/large-json")
      .set("Accept-Encoding", "gzip");

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
  });

  it("compresses large JSON responses when client accepts deflate", async () => {
    const app = createAppWithCompression();

    const res = await request(app)
      .get("/large-json")
      .set("Accept-Encoding", "deflate");

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("deflate");
  });

  it("does not compress small responses below threshold", async () => {
    const app = createAppWithCompression();

    const res = await request(app)
      .get("/small-json")
      .set("Accept-Encoding", "gzip");

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
  });

  it("does not compress when client does not accept encoding", async () => {
    const app = createAppWithCompression();

    const res = await request(app)
      .get("/large-json")
      .set("Accept-Encoding", "identity");

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
  });

  it("returns valid JSON even when compressed", async () => {
    const app = createAppWithCompression();

    const res = await request(app)
      .get("/large-json")
      .set("Accept-Encoding", "gzip");

    expect(res.status).toBe(200);
    const body = res.body;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(200);
    expect(body[0]).toHaveProperty("id");
    expect(body[0]).toHaveProperty("name");
  });
});
