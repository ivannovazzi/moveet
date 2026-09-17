import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";

// dotenv.config() is called on import; stub it before importing config.
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));

vi.mock("../utils/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { verifyConfig, parseEnv, logConfig } from "../utils/config";
import logger from "../utils/logger";

// ─── Helpers ────────────────────────────────────────────────────────

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
    GEOJSON_PATH: "./data/network.geojson",
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

  it("parses FREE_FLOW_FACTORS overrides over the per-class defaults", () => {
    expect(parseEnv({}).FREE_FLOW_FACTORS.residential).toBeGreaterThan(0);
    const cfg = parseEnv(validEnv({ FREE_FLOW_FACTORS: "residential=0.5" }));
    expect(cfg.FREE_FLOW_FACTORS.residential).toBe(0.5);
    expect(() => parseEnv(validEnv({ FREE_FLOW_FACTORS: "residential=2" }))).toThrow();
  });

  it("parses DRIVE_SIDE, defaulting to right-hand traffic", () => {
    expect(parseEnv({}).DRIVE_SIDE).toBe("right");
    expect(parseEnv(validEnv({ DRIVE_SIDE: "left" })).DRIVE_SIDE).toBe("left");
    expect(() => parseEnv(validEnv({ DRIVE_SIDE: "middle" }))).toThrow();
  });

  it("parses speed profile settings, disabled by default", () => {
    const d = parseEnv({});
    expect(d.SPEED_PROFILES_ENABLED).toBe(false);
    expect(d.SPEED_PROFILE_SOURCES).toEqual(["sim"]);
    expect(d.SPEED_PROFILE_PERIOD).toBe("week");
    expect(d.SPEED_PROFILE_BUCKET_HOURS).toBe(1);
    expect(d.SPEED_PROFILE_MIN_SAMPLES).toBe(5);
    expect(d.SPEED_PROFILE_EWMA_ALPHA).toBe(0.2);
    expect(d.SPEED_PROFILE_MAX_SPEED_RATIO).toBe(1);
    expect(d.SPEED_PROFILE_PUBLISH_INTERVAL_MS).toBe(30_000);
    expect(d.SPEED_PROFILE_SEED_FILE).toBe("");

    const c = parseEnv(
      validEnv({
        SPEED_PROFILES_ENABLED: "true",
        SPEED_PROFILE_SOURCES: "sim, adapter",
        SPEED_PROFILE_PERIOD: "day",
        SPEED_PROFILE_BUCKET_HOURS: "6",
        SPEED_PROFILE_MAX_SPEED_RATIO: "1.2",
      })
    );
    expect(c.SPEED_PROFILES_ENABLED).toBe(true);
    expect(c.SPEED_PROFILE_SOURCES).toEqual(["sim", "adapter"]);
    expect(c.SPEED_PROFILE_BUCKET_HOURS).toBe(6);
    expect(c.SPEED_PROFILE_MAX_SPEED_RATIO).toBe(1.2);
  });

  it("rejects invalid speed profile settings", () => {
    expect(() => parseEnv(validEnv({ SPEED_PROFILE_SOURCES: "sim,radar" }))).toThrow();
    expect(() => parseEnv(validEnv({ SPEED_PROFILE_SOURCES: "" }))).toThrow();
    expect(() => parseEnv(validEnv({ SPEED_PROFILE_BUCKET_HOURS: "5" }))).toThrow();
    expect(() =>
      parseEnv(validEnv({ SPEED_PROFILE_PERIOD: "day", SPEED_PROFILE_BUCKET_HOURS: "48" }))
    ).toThrow();
    expect(() => parseEnv(validEnv({ SPEED_PROFILE_MAX_SPEED_RATIO: "0.9" }))).toThrow();
    expect(() => parseEnv(validEnv({ SPEED_PROFILE_EWMA_ALPHA: "0" }))).toThrow();
    expect(() => parseEnv(validEnv({ SPEED_PROFILE_MIN_SAMPLES: "0" }))).toThrow();
  });

  it("parses weather settings, disabled by default with no lat/lon override", () => {
    const d = parseEnv({});
    expect(d.WEATHER_ENABLED).toBe(false);
    expect(d.WEATHER_POLL_INTERVAL_MS).toBe(600_000);
    expect(d.WEATHER_FETCH_TIMEOUT_MS).toBe(5000);
    expect(d.WEATHER_LAT).toBeUndefined();
    expect(d.WEATHER_LON).toBeUndefined();

    const c = parseEnv(
      validEnv({
        WEATHER_ENABLED: "true",
        WEATHER_POLL_INTERVAL_MS: "120000",
        WEATHER_FETCH_TIMEOUT_MS: "2000",
        WEATHER_LAT: "-1.29",
        WEATHER_LON: "36.82",
      })
    );
    expect(c.WEATHER_ENABLED).toBe(true);
    expect(c.WEATHER_POLL_INTERVAL_MS).toBe(120_000);
    expect(c.WEATHER_FETCH_TIMEOUT_MS).toBe(2000);
    expect(c.WEATHER_LAT).toBe(-1.29);
    expect(c.WEATHER_LON).toBe(36.82);
  });

  it("rejects invalid weather settings", () => {
    expect(() => parseEnv(validEnv({ WEATHER_POLL_INTERVAL_MS: "10" }))).toThrow(); // below 1000ms floor
    expect(() => parseEnv(validEnv({ WEATHER_LAT: "500" }))).toThrow(); // out of [-90, 90]
    expect(() => parseEnv(validEnv({ WEATHER_LON: "-500" }))).toThrow(); // out of [-180, 180]
  });

  it("applies defaults when env vars are missing", () => {
    const cfg = parseEnv({});
    expect(cfg.PORT).toBe(5010);
    expect(cfg.UPDATE_INTERVAL).toBe(500);
    expect(cfg.MIN_SPEED).toBe(20);
    expect(cfg.MAX_SPEED).toBe(60);
    expect(cfg.VEHICLE_COUNT).toBe(70);
    expect(cfg.GEOJSON_PATH).toBe("./data/network.geojson");
    expect(cfg.ADAPTER_URL).toBe("");
    expect(cfg.SECTORS_N).toBe(10);
  });

  it("coerces SECTORS_N overrides", () => {
    const cfg = parseEnv(validEnv({ SECTORS_N: "20" }));
    expect(cfg.SECTORS_N).toBe(20);
  });

  it("rejects SECTORS_N=0 (below min 1)", () => {
    expect(() => parseEnv(validEnv({ SECTORS_N: "0" }))).toThrow(
      /Invalid environment configuration/
    );
  });

  it("defaults, clamps and never rejects PATHFINDING_LANDMARKS", () => {
    // The pathfinding worker cannot import this module (its esbuild bundle must
    // stay free of zod/dotenv/pino), so the schema resolves the value and
    // PathfindingPool ships the number in workerData. Out-of-range input is
    // clamped rather than rejected: a bad landmark count must never stop the
    // simulator from booting.
    expect(parseEnv({}).PATHFINDING_LANDMARKS).toBe(4);
    expect(parseEnv(validEnv({ PATHFINDING_LANDMARKS: "" })).PATHFINDING_LANDMARKS).toBe(4);
    expect(parseEnv(validEnv({ PATHFINDING_LANDMARKS: "0" })).PATHFINDING_LANDMARKS).toBe(0);
    expect(parseEnv(validEnv({ PATHFINDING_LANDMARKS: "8" })).PATHFINDING_LANDMARKS).toBe(8);
    expect(parseEnv(validEnv({ PATHFINDING_LANDMARKS: "1000" })).PATHFINDING_LANDMARKS).toBe(32);
    expect(parseEnv(validEnv({ PATHFINDING_LANDMARKS: "-3" })).PATHFINDING_LANDMARKS).toBe(4);
    expect(parseEnv(validEnv({ PATHFINDING_LANDMARKS: "banana" })).PATHFINDING_LANDMARKS).toBe(4);
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
    expect(() => parseEnv(validEnv({ PORT: "99999" }))).toThrow(
      /Invalid environment configuration/
    );
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

// ─── logConfig (structured logging) ─────────────────────────────────

describe("logConfig", () => {
  it("logs through the structured logger, not console.log", () => {
    const consoleSpy = vi.spyOn(console, "log");
    vi.mocked(logger.info).mockClear();

    logConfig();

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [context, message] = vi.mocked(logger.info).mock.calls[0];
    expect(message).toBe("Simulator config");
    expect(context).toHaveProperty("config");

    consoleSpy.mockRestore();
  });

  it("includes the pathfinding landmark count in the dump", () => {
    // The whole point of routing PATHFINDING_LANDMARKS through the schema: it
    // is now visible in the startup config dump like every other tunable.
    vi.mocked(logger.info).mockClear();

    logConfig();

    const [context] = vi.mocked(logger.info).mock.calls[0] as [
      { config: { pathfindingLandmarks: number } },
    ];
    expect(context.config).toHaveProperty("pathfindingLandmarks");
    expect(typeof context.config.pathfindingLandmarks).toBe("number");
  });

  it("redacts the adapter URL", () => {
    vi.mocked(logger.info).mockClear();

    logConfig();

    const [context] = vi.mocked(logger.info).mock.calls[0] as [{ config: { adapterURL: string } }];
    expect(["••••••", "(disabled)"]).toContain(context.config.adapterURL);
  });
});

describe(".env.example completeness", () => {
  // Extract env var names referenced in config.ts (process.env.* or zod schema keys)
  function getConfigEnvVars(): string[] {
    const configPath = path.resolve(__dirname, "../utils/config.ts");
    const source = fs.readFileSync(configPath, "utf-8");
    const vars = new Set<string>();
    // Match process.env.VAR_NAME
    for (const m of source.matchAll(/process\.env\.(\w+)/g)) vars.add(m[1]);
    // Match zod schema field names (e.g. PORT: z.coerce, GEOJSON_PATH: z.string, or multiline z\n.enum)
    for (const m of source.matchAll(/^\s+([A-Z][A-Z0-9_]+)\s*:\s*z[\s.]/gm)) vars.add(m[1]);
    vars.delete("NODE_ENV");
    return [...vars];
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
    expect(missing, `Missing from .env.example: ${missing.join(", ")}`).toEqual([]);
  });

  it("should not document env vars that are not used in config.ts", () => {
    const configVars = getConfigEnvVars();
    const exampleVars = getEnvExampleVars();

    const extra = exampleVars.filter((v) => !configVars.includes(v));
    expect(extra, `Extra vars in .env.example not used in config.ts: ${extra.join(", ")}`).toEqual(
      []
    );
  });
});
