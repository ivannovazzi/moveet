import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PluginManager } from "../plugins/manager";
import { createConfigValidateHandler } from "../routes/configValidate";
import type { ConfigField, DataSink, DataSource } from "../plugins/types";
import type { StartupConfig } from "../utils/config";
import { DEFAULT_OUTBOX_OPTIONS } from "../plugins/outbox";
import { DEFAULT_BREAKER_OPTIONS } from "../plugins/circuit-breaker";

/**
 * Route test for the dry-run endpoint, driving the REAL handler and a REAL
 * PluginManager. Plugins are fakes so the test needs no broker, no network and
 * no external module mocks — and so "did we connect?" is directly observable.
 */

const SOURCE_SCHEMA: ConfigField[] = [
  { name: "url", label: "URL", type: "string", required: true },
  { name: "token", label: "Token", type: "password" },
];

const SINK_SCHEMA: ConfigField[] = [
  { name: "brokers", label: "Brokers", type: "string", required: true },
  { name: "topic", label: "Topic", type: "string" },
];

const connects = { source: 0, sink: 0, console: 0 };

function makeSource(): DataSource {
  return {
    type: "rest",
    name: "REST source",
    configSchema: SOURCE_SCHEMA,
    connect: async () => {
      connects.source++;
    },
    disconnect: async () => {},
    getVehicles: async () => [],
    healthCheck: async () => ({ healthy: true }),
  };
}

function makeSink(): DataSink {
  return {
    type: "redpanda",
    name: "Redpanda sink",
    configSchema: SINK_SCHEMA,
    connect: async () => {
      connects.sink++;
    },
    disconnect: async () => {},
    publishUpdates: async () => {},
    healthCheck: async () => ({ healthy: true }),
  };
}

function makeConsoleSink(): DataSink {
  return {
    type: "console",
    name: "Console sink",
    configSchema: [],
    connect: async () => {
      connects.console++;
    },
    disconnect: async () => {},
    publishUpdates: async () => {},
    healthCheck: async () => ({ healthy: true }),
  };
}

function startupConfig(overrides: Partial<StartupConfig> = {}): StartupConfig {
  return {
    port: 5011,
    corsOrigins: "*",
    source: { type: "rest", config: { url: "http://roster" } },
    sinks: [{ type: "redpanda", config: { brokers: "b:9092" } }],
    realism: {},
    simulatorUrl: "http://localhost:5010",
    delivery: {
      outbox: DEFAULT_OUTBOX_OPTIONS,
      breaker: DEFAULT_BREAKER_OPTIONS,
    },
    origins: {
      configFile: "/etc/moveet/adapter.json",
      source: "file",
      sinkList: "file",
      sinks: { redpanda: "env+file" },
      realism: "default",
    },
    ...overrides,
  };
}

async function buildApp(resolve: () => StartupConfig) {
  const manager = new PluginManager();
  manager.registerSource("rest", makeSource);
  manager.registerSink("redpanda", makeSink);
  manager.registerSink("console", makeConsoleSink);

  // Give the manager a real active plugin set so mutation is detectable.
  await manager.setSource("rest", { url: "http://active" });
  await manager.addSink("console", {});

  const app = express();
  app.use(express.json());
  app.post(
    "/config/validate",
    createConfigValidateHandler({ manager, resolveStartupConfig: resolve })
  );
  return { app, manager };
}

describe("POST /config/validate", () => {
  beforeEach(() => {
    connects.source = 0;
    connects.sink = 0;
    connects.console = 0;
  });

  it("reports the resolved startup config and what it would activate", async () => {
    const { app } = await buildApp(() => startupConfig());
    const connectsAfterSetup = { ...connects };

    const res = await request(app).post("/config/validate").send({});

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.checked).toBe("startup-config");
    expect(res.body.configFile).toBe("/etc/moveet/adapter.json");
    expect(res.body.wouldActivate).toEqual({ source: "rest", sinks: ["redpanda"] });
    expect(res.body.source.origin).toBe("file");
    expect(res.body.sinks[0].origin).toBe("env+file");
    // Reachability is explicitly not checked — no backend was contacted.
    expect(res.body.backendConnectivity.checked).toBe(false);
    expect(connects).toEqual(connectsAfterSetup);
  });

  it("does not mutate the active plugin set and does not connect anything", async () => {
    const { app, manager } = await buildApp(() => startupConfig());
    const before = manager.getConfig();
    const connectsBefore = { ...connects };

    const res = await request(app)
      .post("/config/validate")
      .send({
        source: { type: "rest", config: { url: "http://candidate" } },
        sinks: [{ type: "redpanda", config: { brokers: "candidate:9092" } }],
      });

    expect(res.status).toBe(200);
    expect(res.body.checked).toBe("request-body");
    expect(res.body.wouldActivate).toEqual({ source: "rest", sinks: ["redpanda"] });

    // Active set untouched: still the source/sinks wired during setup.
    const after = manager.getConfig();
    expect(after.activeSource).toBe(before.activeSource);
    expect(after.activeSinks).toEqual(before.activeSinks);
    expect(after.sinkConfig).toEqual(before.sinkConfig);
    expect(after.sourceConfig).toEqual(before.sourceConfig);
    expect(res.body.active).toEqual({ source: "rest", sinks: ["console"] });

    // Nothing was connected by the dry run.
    expect(connects).toEqual(connectsBefore);
  });

  it("returns a precise per-plugin rejection reason for malformed config", async () => {
    const { app } = await buildApp(() => startupConfig());

    const res = await request(app)
      .post("/config/validate")
      .send({
        source: { type: "rest", config: {} },
        sinks: [
          { type: "redpandaa", config: {} },
          { type: "redpanda", config: { brokers: 9092 } },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.errors).toEqual([
      'source(rest).url: required field "url" is missing or empty',
      'sink(redpandaa): unknown sink type "redpandaa" (registered types: redpanda, console); did you mean "redpanda"?',
      "sink(redpanda).brokers: must be a string (got number 9092)",
    ]);
    expect(res.body.wouldActivate).toEqual({ source: null, sinks: [] });
  });

  it("reports a config-resolution failure as an invalid config, not a server error", async () => {
    const { app } = await buildApp(() => {
      throw new Error("Invalid JSON in environment variable SINK_REDPANDA_CONFIG: bad");
    });

    const res = await request(app).post("/config/validate").send({});

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.resolutionError).toMatch(/Invalid JSON in environment variable/);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.wouldActivate).toEqual({ source: null, sinks: [] });
  });

  it("distinguishes a malformed request body (400) from an invalid config (200)", async () => {
    const { app } = await buildApp(() => startupConfig());

    const bad = await request(app).post("/config/validate").send({ sinks: "console" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/'sinks' must be an array/);

    const badEntry = await request(app)
      .post("/config/validate")
      .send({ sinks: [{ config: {} }] });
    expect(badEntry.status).toBe(400);
    expect(badEntry.body.error).toMatch(/'sinks\[0\]\.type' must be a non-empty string/);
  });

  it("redacts secrets in the echoed candidate config", async () => {
    const { app } = await buildApp(() => startupConfig());

    const res = await request(app)
      .post("/config/validate")
      .send({ source: { type: "rest", config: { url: "http://r", token: "s3cret" } } });

    expect(res.body.source.config.token).not.toBe("s3cret");
    expect(res.body.source.config.url).toBe("http://r");
  });

  it("reports warnings without failing validation", async () => {
    const { app } = await buildApp(() => startupConfig());

    const res = await request(app)
      .post("/config/validate")
      .send({ sinks: [{ type: "redpanda", config: { brokers: "b:9092", topci: "v" } }] });

    expect(res.body.valid).toBe(true);
    expect(res.body.warnings[0]).toMatch(/unknown field "topci"/);
    expect(res.body.wouldActivate.sinks).toEqual(["redpanda"]);
  });
});

describe("PluginManager.validateConfig", () => {
  it("is side-effect free on a manager with no plugins connected", () => {
    const manager = new PluginManager();
    const connect = vi.fn();
    manager.registerSink("console", () => ({
      type: "console",
      name: "Console",
      configSchema: [],
      connect,
      disconnect: async () => {},
      publishUpdates: async () => {},
      healthCheck: async () => ({ healthy: true }),
    }));

    const report = manager.validateConfig({ sinks: [{ type: "console", config: {} }] });

    expect(report.valid).toBe(true);
    expect(connect).not.toHaveBeenCalled();
    expect(manager.getConfig().activeSinks).toEqual([]);
  });
});
