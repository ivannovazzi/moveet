import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadConfig } from "./config";

vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PORT;
    delete process.env.CORS_ORIGINS;
    delete process.env.SOURCE_TYPE;
    delete process.env.SOURCE_CONFIG;
    delete process.env.SINK_TYPES;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns defaults when no env vars set", () => {
    const cfg = loadConfig();
    expect(cfg.port).toBe(5011);
    expect(cfg.source.type).toBe("static");
    expect(cfg.source.config).toEqual({ count: 20 });
    expect(cfg.sinks).toEqual([{ type: "console", config: {} }]);
  });

  it("reads SOURCE_TYPE and SOURCE_CONFIG", () => {
    process.env.SOURCE_TYPE = "graphql";
    process.env.SOURCE_CONFIG = '{"url":"http://localhost:4001/graphql","token":"abc"}';

    const cfg = loadConfig();
    expect(cfg.source.type).toBe("graphql");
    expect(cfg.source.config).toEqual({
      url: "http://localhost:4001/graphql",
      token: "abc",
    });
  });

  it("reads SINK_TYPES and per-sink config", () => {
    process.env.SINK_TYPES = "redpanda,console";
    process.env.SINK_REDPANDA_CONFIG = '{"brokers":"localhost:19092","topic":"vehicles"}';
    process.env.SINK_CONSOLE_CONFIG = '{"verbose":true}';

    const cfg = loadConfig();
    expect(cfg.sinks).toEqual([
      { type: "redpanda", config: { brokers: "localhost:19092", topic: "vehicles" } },
      { type: "console", config: { verbose: true } },
    ]);
  });

  it("throws a clear error naming the env var when SOURCE_CONFIG is invalid JSON", () => {
    process.env.SOURCE_CONFIG = "not-json";

    expect(() => loadConfig()).toThrow(/Invalid JSON in environment variable SOURCE_CONFIG/);
  });

  it("throws a clear error naming the env var when a sink config is invalid JSON", () => {
    process.env.SINK_TYPES = "redpanda";
    process.env.SINK_REDPANDA_CONFIG = "{broken";

    expect(() => loadConfig()).toThrow(/Invalid JSON in environment variable SINK_REDPANDA_CONFIG/);
  });

  it("throws a clear error naming the env var when REALISM_CONFIG is invalid JSON", () => {
    process.env.REALISM_CONFIG = "nope";

    expect(() => loadConfig()).toThrow(/Invalid JSON in environment variable REALISM_CONFIG/);
  });

  it("treats unset JSON config env vars as empty objects", () => {
    delete process.env.REALISM_CONFIG;
    const cfg = loadConfig();
    expect(cfg.realism).toEqual({});
  });

  it("reads custom PORT", () => {
    process.env.PORT = "9999";

    const cfg = loadConfig();
    expect(cfg.port).toBe(9999);
  });

  it("does not add default console sink when SINK_TYPES is explicitly set", () => {
    process.env.SINK_TYPES = "redpanda";
    process.env.SINK_REDPANDA_CONFIG = '{"brokers":"localhost:19092"}';

    const cfg = loadConfig();
    expect(cfg.sinks).toHaveLength(1);
    expect(cfg.sinks[0].type).toBe("redpanda");
  });

  it("handles sink type with no matching config env var", () => {
    process.env.SINK_TYPES = "webhook";

    const cfg = loadConfig();
    expect(cfg.sinks).toEqual([{ type: "webhook", config: {} }]);
  });

  it("returns default CORS origins when CORS_ORIGINS is not set", () => {
    const cfg = loadConfig();
    expect(cfg.corsOrigins).toEqual(["http://localhost:5010", "http://localhost:5012"]);
  });

  it("parses custom CORS_ORIGINS from env", () => {
    process.env.CORS_ORIGINS = "https://app.example.com,https://admin.example.com";

    const cfg = loadConfig();
    expect(cfg.corsOrigins).toEqual(["https://app.example.com", "https://admin.example.com"]);
  });

  it("returns wildcard string when CORS_ORIGINS is *", () => {
    process.env.CORS_ORIGINS = "*";

    const cfg = loadConfig();
    expect(cfg.corsOrigins).toBe("*");
  });

  it("trims whitespace from CORS_ORIGINS entries", () => {
    process.env.CORS_ORIGINS = " http://a.com , http://b.com ";

    const cfg = loadConfig();
    expect(cfg.corsOrigins).toEqual(["http://a.com", "http://b.com"]);
  });
});
