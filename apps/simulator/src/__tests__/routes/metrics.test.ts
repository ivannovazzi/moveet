import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createMetricsRoutes } from "../../routes/metrics";
import { metricsMiddleware } from "../../middleware/metrics";
import {
  registry,
  metricsContentType,
  setWsConnectedClients,
  recordWsConnection,
  recordWsDisconnection,
  recordWsDroppedFlush,
  recordWsBackpressureDisconnect,
  recordAdapterSync,
} from "../../metrics";

function createApp() {
  const app = express();
  app.use(metricsMiddleware);
  app.get("/ping", (_req, res) => res.json({ ok: true }));
  app.use(createMetricsRoutes());
  return app;
}

describe("GET /metrics", () => {
  it("returns the Prometheus text exposition with the registry content type", async () => {
    const app = createApp();
    const res = await request(app).get("/metrics");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain(metricsContentType.split(";")[0]);
    // Default Node collectors are always present.
    expect(res.text).toContain("process_cpu_user_seconds_total");
    // At least one of our custom collectors is registered/exported.
    expect(res.text).toContain("moveet_ws_connected_clients");
  });

  it("reflects a known WebSocket gauge value", async () => {
    setWsConnectedClients(7);
    const app = createApp();
    const res = await request(app).get("/metrics");
    expect(res.text).toMatch(/moveet_ws_connected_clients 7/);
  });

  it("exposes adapter sync counters after recording an outcome", async () => {
    recordAdapterSync("success", 0.12);
    recordAdapterSync("failure", 0.34);
    const res = await request(createApp()).get("/metrics");
    expect(res.text).toContain('moveet_adapter_sync_total{result="success"}');
    expect(res.text).toContain('moveet_adapter_sync_total{result="failure"}');
    expect(res.text).toContain("moveet_adapter_sync_duration_seconds");
  });

  it("observes HTTP request duration via the middleware", async () => {
    const app = createApp();
    await request(app).get("/ping");
    const res = await request(app).get("/metrics");
    expect(res.text).toContain("moveet_http_request_duration_seconds");
    expect(res.text).toContain('route="/ping"');
  });

  it("WS gauge reflects connect then disconnect", async () => {
    // Simulate the broadcaster reporting its live client count on connect/disconnect.
    recordWsConnection(1);
    let metricLines = await registry.metrics();
    expect(metricLines).toMatch(/moveet_ws_connected_clients 1/);
    expect(metricLines).toMatch(/moveet_ws_connections_total \d/);

    recordWsConnection(2);
    metricLines = await registry.metrics();
    expect(metricLines).toMatch(/moveet_ws_connected_clients 2/);

    recordWsDisconnection(0);
    metricLines = await registry.metrics();
    expect(metricLines).toMatch(/moveet_ws_connected_clients 0/);
  });

  it("increments backpressure counters", async () => {
    recordWsDroppedFlush();
    recordWsBackpressureDisconnect();
    const res = await request(createApp()).get("/metrics");
    expect(res.text).toContain("moveet_ws_dropped_flushes_total");
    expect(res.text).toContain("moveet_ws_backpressure_disconnects_total");
  });
});
