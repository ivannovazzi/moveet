import { describe, it, expect, vi } from "vitest";

// Stub dotenv so it doesn't try to load a .env file during tests.
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));

import { parseEnv, loadConfig } from "../utils/config";

/** Build a valid env object with all defaults, then apply overrides. */
function validEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    PORT: "5011",
    SOURCE_TYPE: "static",
    SOURCE_CONFIG: "",
    SINK_TYPES: "",
    ...overrides,
  };
}

// ─── parseEnv ────────────────────────────────────────────────────────

describe("parseEnv", () => {
  it("parses a valid complete env", () => {
    const cfg = parseEnv(validEnv());
    expect(cfg.PORT).toBe(5011);
    expect(cfg.SOURCE_TYPE).toBe("static");
  });

  it("applies defaults when env vars are missing", () => {
    const cfg = parseEnv({});
    expect(cfg.PORT).toBe(5011);
    expect(cfg.SOURCE_TYPE).toBe("static");
    expect(cfg.SOURCE_CONFIG).toBe("");
    expect(cfg.SINK_TYPES).toBe("");
  });

  it("coerces string port to number", () => {
    const cfg = parseEnv(validEnv({ PORT: "3000" }));
    expect(cfg.PORT).toBe(3000);
  });

  it("rejects PORT=abc (non-numeric)", () => {
    expect(() => parseEnv(validEnv({ PORT: "abc" }))).toThrow(/Invalid environment configuration/);
  });

  it("rejects PORT=0 (below min)", () => {
    expect(() => parseEnv(validEnv({ PORT: "0" }))).toThrow(/Invalid environment configuration/);
  });

  it("rejects PORT=99999 (above max)", () => {
    expect(() => parseEnv(validEnv({ PORT: "99999" }))).toThrow(
      /Invalid environment configuration/
    );
  });

  it("accepts boundary port values", () => {
    expect(() => parseEnv(validEnv({ PORT: "1" }))).not.toThrow();
    expect(() => parseEnv(validEnv({ PORT: "65535" }))).not.toThrow();
  });

  it("includes field names in error messages", () => {
    try {
      parseEnv(validEnv({ PORT: "abc" }));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("PORT");
    }
  });
});

// ─── loadConfig ──────────────────────────────────────────────────────

describe("loadConfig", () => {
  it("returns default config when env is empty", () => {
    const cfg = loadConfig({});
    expect(cfg.port).toBe(5011);
    expect(cfg.source.type).toBe("static");
    expect(cfg.source.config).toHaveProperty("count", 20);
    expect(cfg.sinks).toEqual([{ type: "console", config: {} }]);
  });

  it("parses SOURCE_CONFIG as JSON", () => {
    const cfg = loadConfig(
      validEnv({ SOURCE_TYPE: "graphql", SOURCE_CONFIG: '{"url":"http://api.test"}' })
    );
    expect(cfg.source.config).toEqual({ url: "http://api.test" });
  });

  it("sets default count for static source when not provided", () => {
    const cfg = loadConfig(validEnv({ SOURCE_TYPE: "static", SOURCE_CONFIG: "{}" }));
    expect(cfg.source.config.count).toBe(20);
  });

  it("does not override explicit count for static source", () => {
    const cfg = loadConfig(validEnv({ SOURCE_TYPE: "static", SOURCE_CONFIG: '{"count":5}' }));
    expect(cfg.source.config.count).toBe(5);
  });

  it("parses comma-separated SINK_TYPES", () => {
    const env = validEnv({ SINK_TYPES: "console,graphql" });
    const cfg = loadConfig(env);
    expect(cfg.sinks).toHaveLength(2);
    expect(cfg.sinks[0].type).toBe("console");
    expect(cfg.sinks[1].type).toBe("graphql");
  });

  it("reads per-sink config from SINK_<TYPE>_CONFIG env var", () => {
    const env = {
      ...validEnv({ SINK_TYPES: "graphql" }),
      SINK_GRAPHQL_CONFIG: '{"url":"http://gql.test"}',
    };
    const cfg = loadConfig(env);
    expect(cfg.sinks[0].config).toEqual({ url: "http://gql.test" });
  });

  it("defaults to console sink when SINK_TYPES is not set", () => {
    const cfg = loadConfig(validEnv());
    expect(cfg.sinks).toEqual([{ type: "console", config: {} }]);
  });

  it("does not add console default when SINK_TYPES is explicitly set", () => {
    const cfg = loadConfig(validEnv({ SINK_TYPES: "graphql" }));
    expect(cfg.sinks.map((s) => s.type)).toEqual(["graphql"]);
  });

  it("propagates zod validation errors for invalid PORT", () => {
    expect(() => loadConfig(validEnv({ PORT: "abc" }))).toThrow(
      /Invalid environment configuration/
    );
  });
});
