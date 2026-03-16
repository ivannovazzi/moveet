import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";

// We test verifyConfig in isolation by controlling both the `config` values
// (via vi.mock) and the filesystem (vi.spyOn on fs.existsSync).

// Note: `config` is a `const` object built at module evaluation time, so we
// cannot change it between tests via re-import.  Instead we spy on
// `fs.existsSync` to simulate a missing file, and we import `verifyConfig`
// directly — each call reads the live `config` object.  For range-validation
// tests we temporarily write to the mutable cast of `config`.

vi.mock("../utils/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// dotenv.config() is called on import; stub it before importing config.
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));

import { config, verifyConfig } from "../utils/config";

// ─── Helpers ────────────────────────────────────────────────────────

/** Mutate the readonly `config` object for a single test. */
function withConfig(overrides: Partial<typeof config>, fn: () => void): void {
  const saved: Partial<typeof config> = {};
  for (const k of Object.keys(overrides) as (keyof typeof config)[]) {
    saved[k] = (config as Record<string, unknown>)[k] as never;
    (config as Record<string, unknown>)[k] = overrides[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(saved) as (keyof typeof config)[]) {
      (config as Record<string, unknown>)[k] = saved[k];
    }
  }
}

// ─── Tests ──────────────────────────────────────────────────────────

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

  describe("port range", () => {
    it("throws when port is 0", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      withConfig({ port: 0 }, () => {
        expect(() => verifyConfig()).toThrow(/PORT must be between 1 and 65535/i);
      });
    });

    it("throws when port exceeds 65535", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      withConfig({ port: 65536 }, () => {
        expect(() => verifyConfig()).toThrow(/PORT must be between 1 and 65535/i);
      });
    });

    it("accepts boundary values 1 and 65535", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      withConfig({ port: 1 }, () => expect(() => verifyConfig()).not.toThrow());
      withConfig({ port: 65535 }, () => expect(() => verifyConfig()).not.toThrow());
    });
  });

  describe("updateInterval", () => {
    it("throws when updateInterval is 0", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      withConfig({ updateInterval: 0 }, () => {
        expect(() => verifyConfig()).toThrow(/UPDATE_INTERVAL must be positive/i);
      });
    });

    it("accepts positive updateInterval", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      withConfig({ updateInterval: 1 }, () => expect(() => verifyConfig()).not.toThrow());
    });
  });

  describe("speed ordering", () => {
    it("throws when maxSpeed equals minSpeed", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      withConfig({ minSpeed: 40, maxSpeed: 40 }, () => {
        expect(() => verifyConfig()).toThrow(/MAX_SPEED.*must be greater than MIN_SPEED/i);
      });
    });

    it("throws when maxSpeed is less than minSpeed", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      withConfig({ minSpeed: 60, maxSpeed: 30 }, () => {
        expect(() => verifyConfig()).toThrow(/MAX_SPEED.*must be greater than MIN_SPEED/i);
      });
    });

    it("throws when minSpeed is negative", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      withConfig({ minSpeed: -1, maxSpeed: 60 }, () => {
        expect(() => verifyConfig()).toThrow(/MIN_SPEED must be non-negative/i);
      });
    });

    it("accepts minSpeed 0 with maxSpeed > 0", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      withConfig({ minSpeed: 0, maxSpeed: 1 }, () => expect(() => verifyConfig()).not.toThrow());
    });
  });

  describe("speedVariation range [0, 1]", () => {
    it("throws when speedVariation is negative", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      withConfig({ speedVariation: -0.1 }, () => {
        expect(() => verifyConfig()).toThrow(/SPEED_VARIATION must be between 0 and 1/i);
      });
    });

    it("throws when speedVariation exceeds 1", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      withConfig({ speedVariation: 1.01 }, () => {
        expect(() => verifyConfig()).toThrow(/SPEED_VARIATION must be between 0 and 1/i);
      });
    });

    it("accepts boundary values 0 and 1", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      withConfig({ speedVariation: 0 }, () => expect(() => verifyConfig()).not.toThrow());
      withConfig({ speedVariation: 1 }, () => expect(() => verifyConfig()).not.toThrow());
    });
  });

  describe("heatZoneSpeedFactor range [0, 1]", () => {
    it("throws when heatZoneSpeedFactor is negative", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      withConfig({ heatZoneSpeedFactor: -0.1 }, () => {
        expect(() => verifyConfig()).toThrow(/HEATZONE_SPEED_FACTOR must be between 0 and 1/i);
      });
    });

    it("throws when heatZoneSpeedFactor exceeds 1", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      withConfig({ heatZoneSpeedFactor: 1.5 }, () => {
        expect(() => verifyConfig()).toThrow(/HEATZONE_SPEED_FACTOR must be between 0 and 1/i);
      });
    });
  });

  describe("syncAdapterTimeout", () => {
    it("throws when syncAdapterTimeout is negative", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      withConfig({ syncAdapterTimeout: -1 }, () => {
        expect(() => verifyConfig()).toThrow(/SYNC_ADAPTER_TIMEOUT must be non-negative/i);
      });
    });

    it("accepts 0 for syncAdapterTimeout", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      withConfig({ syncAdapterTimeout: 0 }, () => expect(() => verifyConfig()).not.toThrow());
    });
  });

  describe("vehicleCount", () => {
    it("throws when vehicleCount is 0", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      withConfig({ vehicleCount: 0 }, () => {
        expect(() => verifyConfig()).toThrow(/VEHICLE_COUNT must be at least 1/i);
      });
    });

    it("accepts vehicleCount of 1", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      withConfig({ vehicleCount: 1 }, () => expect(() => verifyConfig()).not.toThrow());
    });
  });
});
