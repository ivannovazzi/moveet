import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";

// dotenv.config() is called on import; stub it before importing config.
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));

vi.mock("../utils/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { config, verifyConfig, parseEnv, envSchema } from "../utils/config";

// ─── Helpers ────────────────────────────────────────────────────────

/** Mutate the readonly `config` object for a single test. */
function withConfig(overrides: Partial<typeof config>, fn: () => void): void {
  const mutable = config as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  for (const k of Object.keys(overrides) as (keyof typeof config)[]) {
    saved[k] = mutable[k];
    mutable[k] = overrides[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(saved)) {
      mutable[k] = saved[k];
    }
  }
}

/** Build a valid env object with all defaults, then apply overrides. */
function validEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    PORT: "5010",
    UPDATE_INTERVAL: "500",
    MIN_SPEED: "20",
    MAX_SPEED: "60",
    ACCELERATION: "5",
    DECELERATION: "7",
    TURN_THRESHOLD: "30",
    SPEED_VARIATION: "0.1",
    HEATZONE_SPEED_FACTOR: "0.5",
    SYNC_ADAPTER_TIMEOUT: "5000",
    VEHICLE_COUNT: "70",
    GEOJSON_PATH: "./export.geojson",
    ADAPTER_URL: "",
    ...overrides,
  };
}

// ─── Zod Schema Tests ───────────────────────────────────────────────

describe("envSchema / parseEnv", () => {
  it("parses a valid complete env", () => {
    const cfg = parseEnv(validEnv());
    expect(cfg.PORT).toBe(5010);
    expect(cfg.MIN_SPEED).toBe(20);
    expect(cfg.MAX_SPEED).toBe(60);
    expect(cfg.VEHICLE_COUNT).toBe(70);
    expect(cfg.SPEED_VARIATION).toBe(0.1);
  });

  it("applies defaults when env vars are missing", () => {
    const cfg = parseEnv({});
    expect(cfg.PORT).toBe(5010);
    expect(cfg.UPDATE_INTERVAL).toBe(500);
    expect(cfg.MIN_SPEED).toBe(20);
    expect(cfg.MAX_SPEED).toBe(60);
    expect(cfg.VEHICLE_COUNT).toBe(70);
    expect(cfg.GEOJSON_PATH).toBe("./export.geojson");
    expect(cfg.ADAPTER_URL).toBe("");
  });

  it("coerces string env values to numbers", () => {
    const cfg = parseEnv(validEnv({ PORT: "3000", VEHICLE_COUNT: "10" }));
    expect(cfg.PORT).toBe(3000);
    expect(cfg.VEHICLE_COUNT).toBe(10);
  });

  it("rejects PORT=abc (non-numeric)", () => {
    expect(() => parseEnv(validEnv({ PORT: "abc" }))).toThrow(/Invalid environment configuration/);
  });

  it("rejects PORT=0 (below min)", () => {
    expect(() => parseEnv(validEnv({ PORT: "0" }))).toThrow(/Invalid environment configuration/);
  });

  it("rejects PORT=99999 (above max)", () => {
    expect(() => parseEnv(validEnv({ PORT: "99999" }))).toThrow(/Invalid environment configuration/);
  });

  it("rejects VEHICLE_COUNT=0 (below min 1)", () => {
    expect(() => parseEnv(validEnv({ VEHICLE_COUNT: "0" }))).toThrow(
      /Invalid environment configuration/
    );
  });

  it("rejects SPEED_VARIATION=2 (above max 1)", () => {
    expect(() => parseEnv(validEnv({ SPEED_VARIATION: "2" }))).toThrow(
      /Invalid environment configuration/
    );
  });

  it("rejects SPEED_VARIATION=-0.5 (below min 0)", () => {
    expect(() => parseEnv(validEnv({ SPEED_VARIATION: "-0.5" }))).toThrow(
      /Invalid environment configuration/
    );
  });

  it("rejects HEATZONE_SPEED_FACTOR=1.5 (above max 1)", () => {
    expect(() => parseEnv(validEnv({ HEATZONE_SPEED_FACTOR: "1.5" }))).toThrow(
      /Invalid environment configuration/
    );
  });

  it("rejects UPDATE_INTERVAL=0 (below min 1)", () => {
    expect(() => parseEnv(validEnv({ UPDATE_INTERVAL: "0" }))).toThrow(
      /Invalid environment configuration/
    );
  });

  it("rejects SYNC_ADAPTER_TIMEOUT=-1 (below min 0)", () => {
    expect(() => parseEnv(validEnv({ SYNC_ADAPTER_TIMEOUT: "-1" }))).toThrow(
      /Invalid environment configuration/
    );
  });

  it("rejects when MAX_SPEED <= MIN_SPEED (refinement)", () => {
    expect(() => parseEnv(validEnv({ MIN_SPEED: "60", MAX_SPEED: "60" }))).toThrow(
      /MAX_SPEED must be greater than MIN_SPEED/
    );
    expect(() => parseEnv(validEnv({ MIN_SPEED: "70", MAX_SPEED: "60" }))).toThrow(
      /MAX_SPEED must be greater than MIN_SPEED/
    );
  });

  it("accepts boundary values", () => {
    expect(() => parseEnv(validEnv({ PORT: "1" }))).not.toThrow();
    expect(() => parseEnv(validEnv({ PORT: "65535" }))).not.toThrow();
    expect(() => parseEnv(validEnv({ SPEED_VARIATION: "0" }))).not.toThrow();
    expect(() => parseEnv(validEnv({ SPEED_VARIATION: "1" }))).not.toThrow();
    expect(() => parseEnv(validEnv({ HEATZONE_SPEED_FACTOR: "0" }))).not.toThrow();
    expect(() => parseEnv(validEnv({ HEATZONE_SPEED_FACTOR: "1" }))).not.toThrow();
    expect(() => parseEnv(validEnv({ SYNC_ADAPTER_TIMEOUT: "0" }))).not.toThrow();
    expect(() => parseEnv(validEnv({ VEHICLE_COUNT: "1" }))).not.toThrow();
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

// ─── verifyConfig (runtime file checks) ─────────────────────────────

describe("verifyConfig", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GeoJSON path validation", () => {
    it("throws when geojsonPath resolves to a missing file", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      expect(() => verifyConfig()).toThrow(/GeoJSON file not found/i);
    });

    it("passes when geojsonPath file exists", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      expect(() => verifyConfig()).not.toThrow();
    });
  });
});

describe(".env.example completeness", () => {
  // Extract env var names referenced by process.env.* in config.ts
  function getConfigEnvVars(): string[] {
    const configPath = path.resolve(__dirname, "../utils/config.ts");
    const source = fs.readFileSync(configPath, "utf-8");
    const matches = source.matchAll(/process\.env\.(\w+)/g);
    return [...new Set([...matches].map((m) => m[1]))].filter(
      // NODE_ENV is a runtime-only variable, not a project config variable
      (v) => v !== "NODE_ENV"
    );
  }

  // Parse .env.example for defined variable names (including commented-out ones)
  function getEnvExampleVars(): string[] {
    const envExamplePath = path.resolve(__dirname, "../../.env.example");
    const content = fs.readFileSync(envExamplePath, "utf-8");
    const matches = content.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)\s*=/gm);
    return [...new Set([...matches].map((m) => m[1]))];
  }

  it("should document every env var used in config.ts", () => {
    const configVars = getConfigEnvVars();
    const exampleVars = getEnvExampleVars();

    const missing = configVars.filter((v) => !exampleVars.includes(v));
    expect(missing, `Missing from .env.example: ${missing.join(", ")}`).toEqual(
      []
    );
  });

  it("should not document env vars that are not used in config.ts", () => {
    const configVars = getConfigEnvVars();
    const exampleVars = getEnvExampleVars();

    const extra = exampleVars.filter((v) => !configVars.includes(v));
    expect(
      extra,
      `Extra vars in .env.example not used in config.ts: ${extra.join(", ")}`
    ).toEqual([]);
  });
});
