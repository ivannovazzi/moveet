import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadConfig } from "./config";

vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PORT;
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

  it("handles invalid JSON gracefully", () => {
    process.env.SOURCE_CONFIG = "not-json";

    const cfg = loadConfig();
    expect(cfg.source.config).toEqual({ count: 20 });
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
});
