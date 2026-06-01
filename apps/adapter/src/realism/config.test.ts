import { describe, it, expect } from "vitest";
import { resolveRealismConfig, REALISM_SCHEMA, DEFAULT_REALISM_CONFIG } from "./config";

describe("resolveRealismConfig", () => {
  it("returns defaults for empty input", () => {
    const c = resolveRealismConfig({});
    expect(c).toEqual(DEFAULT_REALISM_CONFIG);
  });

  it("merges partial overrides (shallow + nested gps/connectivity)", () => {
    const c = resolveRealismConfig({
      enabled: true,
      gps: { connectedSigmaM: 9 },
    });
    expect(c.enabled).toBe(true);
    expect(c.gps.connectedSigmaM).toBe(9);
    expect(c.gps.degradedSigmaM).toBe(DEFAULT_REALISM_CONFIG.gps.degradedSigmaM);
    expect(c.reportingPeriodMs).toBe(DEFAULT_REALISM_CONFIG.reportingPeriodMs);
  });

  it("clamps invalid numbers to defaults", () => {
    const c = resolveRealismConfig({
      reportingPeriodMs: -5,
      jitterMs: "x" as unknown as number,
    });
    expect(c.reportingPeriodMs).toBe(DEFAULT_REALISM_CONFIG.reportingPeriodMs);
    expect(c.jitterMs).toBe(DEFAULT_REALISM_CONFIG.jitterMs);
  });
});

describe("REALISM_SCHEMA", () => {
  it("exposes an enabled boolean field first", () => {
    expect(REALISM_SCHEMA[0]).toMatchObject({
      name: "enabled",
      type: "boolean",
    });
  });
});
