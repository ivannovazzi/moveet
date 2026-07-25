import { describe, it, expect } from "vitest";
import { PluginRegistry } from "./registry";
import { validatePluginSet } from "./validation";
import type { ConfigField, DataSink, DataSource } from "./types";

/**
 * Fake plugins with realistic `configSchema`s. Using fakes (rather than the
 * real graphql/redpanda plugins) keeps this test free of external deps while
 * exercising every ConfigField type the real plugins declare.
 */
function makeSource(type: string, configSchema: ConfigField[]): DataSource {
  return {
    type,
    name: `${type} source`,
    configSchema,
    connect: async () => {
      throw new Error("connect() must not be called during validation");
    },
    disconnect: async () => {},
    getVehicles: async () => [],
    healthCheck: async () => ({ healthy: true }),
  };
}

function makeSink(type: string, configSchema: ConfigField[]): DataSink {
  return {
    type,
    name: `${type} sink`,
    configSchema,
    connect: async () => {
      throw new Error("connect() must not be called during validation");
    },
    disconnect: async () => {},
    publishUpdates: async () => {},
    healthCheck: async () => ({ healthy: true }),
  };
}

const SOURCE_SCHEMA: ConfigField[] = [
  { name: "url", label: "URL", type: "string", required: true },
  { name: "token", label: "Auth Token", type: "password" },
  { name: "maxVehicles", label: "Max Vehicles", type: "number", default: 0 },
  { name: "fieldMap", label: "Field Map", type: "json" },
  {
    name: "method",
    label: "Method",
    type: "select",
    options: [
      { label: "GET", value: "GET" },
      { label: "POST", value: "POST" },
    ],
  },
];

const SINK_SCHEMA: ConfigField[] = [
  { name: "brokers", label: "Brokers", type: "string", required: true },
  { name: "topic", label: "Topic", type: "string" },
  { name: "batchSize", label: "Batch Size", type: "number" },
  { name: "tlsRejectUnauthorized", label: "TLS Reject", type: "boolean" },
  { name: "saslPassword", label: "SASL Password", type: "password" },
  {
    name: "saslMechanism",
    label: "SASL Mechanism",
    type: "select",
    options: [
      { label: "PLAIN", value: "plain" },
      { label: "SCRAM-SHA-256", value: "scram-sha-256" },
    ],
  },
];

function makeRegistry(): PluginRegistry {
  const registry = new PluginRegistry();
  registry.registerSource("rest", () => makeSource("rest", SOURCE_SCHEMA));
  registry.registerSource("static", () => makeSource("static", []));
  registry.registerSink("redpanda", () => makeSink("redpanda", SINK_SCHEMA));
  registry.registerSink("console", () => makeSink("console", []));
  return registry;
}

describe("validatePluginSet", () => {
  const registry = makeRegistry();

  it("accepts a well-formed set and reports what would be activated", () => {
    const report = validatePluginSet(
      {
        source: { type: "rest", config: { url: "http://roster", method: "GET" } },
        sinks: [
          { type: "redpanda", config: { brokers: "b:9092", batchSize: 500 } },
          { type: "console", config: {} },
        ],
      },
      registry
    );

    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.wouldActivate).toEqual({ source: "rest", sinks: ["redpanda", "console"] });
  });

  it("rejects an unknown plugin type with the registered types and a typo hint", () => {
    const report = validatePluginSet({ sinks: [{ type: "redpandaa", config: {} }] }, registry);

    expect(report.valid).toBe(false);
    expect(report.sinks[0].issues[0].message).toMatch(/unknown sink type "redpandaa"/);
    expect(report.sinks[0].issues[0].message).toMatch(/registered types: redpanda, console/);
    expect(report.sinks[0].issues[0].message).toMatch(/did you mean "redpanda"\?/);
    expect(report.wouldActivate.sinks).toEqual([]);
  });

  it("rejects a missing required field", () => {
    const report = validatePluginSet({ source: { type: "rest", config: {} } }, registry);

    expect(report.valid).toBe(false);
    expect(report.errors).toContain('source(rest).url: required field "url" is missing or empty');
    expect(report.wouldActivate.source).toBeNull();
  });

  it("treats an empty string in a required field as missing", () => {
    const report = validatePluginSet({ source: { type: "rest", config: { url: "" } } }, registry);
    expect(report.valid).toBe(false);
    expect(report.errors[0]).toMatch(/required field "url" is missing or empty/);
  });

  it("rejects a wrong value type with a precise per-field message", () => {
    const report = validatePluginSet(
      {
        source: {
          type: "rest",
          config: { url: { host: "roster" }, maxVehicles: "many", fieldMap: 7 },
        },
      },
      registry
    );

    expect(report.valid).toBe(false);
    expect(report.errors).toEqual([
      "source(rest).url: must be a string (got an object)",
      'source(rest).maxVehicles: must be a number (got string "many")',
      "source(rest).fieldMap: must be a JSON object (got number 7)",
    ]);
  });

  it("rejects a select value that is not one of the declared options", () => {
    const report = validatePluginSet(
      { source: { type: "rest", config: { url: "http://r", method: "PUT" } } },
      registry
    );

    expect(report.valid).toBe(false);
    expect(report.errors[0]).toBe(
      'source(rest).method: must be one of [GET, POST] (got string "PUT")'
    );
  });

  it("accepts coercions the plugins themselves perform", () => {
    const report = validatePluginSet(
      {
        sinks: [
          {
            type: "redpanda",
            config: {
              brokers: "b:9092",
              batchSize: "250",
              tlsRejectUnauthorized: "false",
              // Real sinks lowercase the mechanism before use.
              saslMechanism: "PLAIN",
            },
          },
        ],
      },
      registry
    );

    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it("warns (but stays valid) on an unknown field, with a did-you-mean hint", () => {
    const report = validatePluginSet(
      { sinks: [{ type: "redpanda", config: { brokers: "b:9092", topci: "vehicles" } }] },
      registry
    );

    expect(report.valid).toBe(true);
    expect(report.warnings).toEqual([
      'sink(redpanda).topci: unknown field "topci" — it is not in this plugin\'s config schema and will be ignored; did you mean "topic"?',
    ]);
    expect(report.wouldActivate.sinks).toEqual(["redpanda"]);
  });

  it("redacts secrets in the echoed config", () => {
    const report = validatePluginSet(
      { source: { type: "rest", config: { url: "http://r", token: "s3cret" } } },
      registry
    );

    expect(report.source?.config.token).not.toBe("s3cret");
    expect(report.source?.config.url).toBe("http://r");
  });

  it("keeps valid plugins activatable when a sibling is malformed", () => {
    const report = validatePluginSet(
      {
        source: { type: "rest", config: {} },
        sinks: [
          { type: "console", config: {} },
          { type: "redpanda", config: {} },
        ],
      },
      registry
    );

    expect(report.valid).toBe(false);
    expect(report.wouldActivate).toEqual({ source: null, sinks: ["console"] });
  });

  it("echoes the origin label it was given", () => {
    const report = validatePluginSet(
      { source: { type: "static", config: {}, origin: "env+file" } },
      registry
    );
    expect(report.source?.origin).toBe("env+file");
  });
});
