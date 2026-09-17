import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createWeatherRoutes } from "../../routes/weather";
import { WeatherManager, type FetchLike } from "../../modules/weather/WeatherManager";
import type { RouteContext } from "../../routes/types";

vi.mock("../../utils/logger", () => {
  const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  return { default: log, createLogger: () => log };
});

function app() {
  const weatherManager = new WeatherManager(
    { enabled: false, pollIntervalMs: 60_000, fetchTimeoutMs: 5000, lat: 0, lon: 0 },
    vi.fn<FetchLike>()
  );
  const ctx = { weatherManager } as unknown as RouteContext;
  const a = express();
  a.use(express.json());
  a.use(createWeatherRoutes(ctx));
  return { a, weatherManager };
}

describe("weather routes", () => {
  it("GET /weather returns the default clear/1.0 state when nothing has been set", async () => {
    const { a } = app();
    const res = await request(a).get("/weather");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      condition: "clear",
      speedFactor: 1,
      source: "live",
      observedAt: null,
    });
  });

  it("POST /weather sets a factor override", async () => {
    const { a, weatherManager } = app();
    const res = await request(a).post("/weather").send({ factor: 0.4 });
    expect(res.status).toBe(200);
    expect(res.body.speedFactor).toBe(0.4);
    expect(res.body.source).toBe("override");
    expect(weatherManager.factor).toBe(0.4);
  });

  it("POST /weather sets an override by condition name", async () => {
    const { a } = app();
    const res = await request(a).post("/weather").send({ condition: "snow" });
    expect(res.status).toBe(200);
    expect(res.body.condition).toBe("snow");
    expect(res.body.speedFactor).toBeGreaterThan(0);
    expect(res.body.speedFactor).toBeLessThan(1);
  });

  it("POST /weather rejects an empty body", async () => {
    const { a } = app();
    const res = await request(a).post("/weather").send({});
    expect(res.status).toBe(400);
  });

  it("POST /weather rejects a factor outside (0, 1]", async () => {
    const { a } = app();
    expect((await request(a).post("/weather").send({ factor: 0 })).status).toBe(400);
    expect((await request(a).post("/weather").send({ factor: 1.5 })).status).toBe(400);
    expect((await request(a).post("/weather").send({ factor: -0.2 })).status).toBe(400);
  });

  it("POST /weather rejects an unknown condition", async () => {
    const { a } = app();
    const res = await request(a).post("/weather").send({ condition: "hurricane" });
    expect(res.status).toBe(400);
  });

  it("DELETE /weather clears an override and reverts to the live reading", async () => {
    const { a, weatherManager } = app();
    weatherManager.setOverride({ factor: 0.3 });
    const res = await request(a).delete("/weather");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("live");
    expect(weatherManager.hasOverride()).toBe(false);
  });
});
