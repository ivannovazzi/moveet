import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { z } from "zod";
import { validateBody, validateQuery, validateParams } from "../../middleware/validate";

function createBodyApp(schema: z.ZodType) {
  const app = express();
  app.use(express.json());
  app.post("/test", validateBody(schema), (_req, res) => {
    res.json({ ok: true, body: _req.body });
  });
  return app;
}

function createQueryApp(schema: z.ZodType) {
  const app = express();
  app.get("/test", validateQuery(schema), (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

function createParamsApp(schema: z.ZodType) {
  const app = express();
  app.get("/test/:id", validateParams(schema), (req, res) => {
    res.json({ ok: true, id: req.params.id });
  });
  return app;
}

describe("validateBody", () => {
  const schema = z.object({
    name: z.string().min(1, "name is required"),
    age: z.number().int().positive("age must be positive"),
  });

  it("should pass valid body through", async () => {
    const app = createBodyApp(schema);
    const res = await request(app).post("/test").send({ name: "Alice", age: 30 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.body).toEqual({ name: "Alice", age: 30 });
  });

  it("should return 400 for invalid body", async () => {
    const app = createBodyApp(schema);
    const res = await request(app).post("/test").send({ name: "", age: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it("should include field path in error details", async () => {
    const app = createBodyApp(schema);
    const res = await request(app).post("/test").send({ name: 123, age: "abc" });
    expect(res.status).toBe(400);
    const details = res.body.details as string[];
    expect(details.some((d) => d.includes("name"))).toBe(true);
    expect(details.some((d) => d.includes("age"))).toBe(true);
  });

  it("should replace req.body with parsed data (transform)", async () => {
    const transformSchema = z.object({
      count: z.string().transform((s) => parseInt(s, 10)),
    });
    const app = createBodyApp(transformSchema);
    const res = await request(app).post("/test").send({ count: "42" });
    expect(res.status).toBe(200);
    expect(res.body.body.count).toBe(42);
  });

  it("should return 400 for missing body fields", async () => {
    const app = createBodyApp(schema);
    const res = await request(app).post("/test").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });
});

describe("validateQuery", () => {
  const schema = z.object({
    page: z.string().min(1),
    limit: z.string().min(1),
  });

  it("should pass valid query through", async () => {
    const app = createQueryApp(schema);
    const res = await request(app).get("/test?page=1&limit=10");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("should return 400 for invalid query", async () => {
    const app = createQueryApp(schema);
    const res = await request(app).get("/test");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });
});

describe("validateParams", () => {
  const schema = z.object({
    id: z.string().uuid("id must be a valid UUID"),
  });

  it("should pass valid params through", async () => {
    const app = createParamsApp(schema);
    const res = await request(app).get("/test/550e8400-e29b-41d4-a716-446655440000");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("should return 400 for invalid params", async () => {
    const app = createParamsApp(schema);
    const res = await request(app).get("/test/not-a-uuid");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(res.body.details.some((d: string) => d.includes("UUID"))).toBe(true);
  });
});
