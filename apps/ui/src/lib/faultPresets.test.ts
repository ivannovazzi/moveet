import { describe, it, expect } from "vitest";
import {
  FAULT_KIND_LABEL,
  FAULT_PRESETS,
  countMisbehavingDevices,
  describeProfile,
  matchPreset,
} from "./faultPresets";
import type { DeviceFaultKind, DeviceFaultStatus } from "@/types";

const KINDS: DeviceFaultKind[] = [
  "frozen_gps",
  "clock_skew",
  "duplicate",
  "out_of_order",
  "battery_dead",
  "teleport",
];

function status(overrides: Partial<DeviceFaultStatus> = {}): DeviceFaultStatus {
  return {
    enabled: true,
    devices: 4,
    frozen: 0,
    teleporting: 0,
    dead: 0,
    held: 0,
    queued: 0,
    counts: {
      frozen_gps: 0,
      clock_skew: 0,
      duplicate: 0,
      out_of_order: 0,
      battery_dead: 0,
      teleport: 0,
    },
    ...overrides,
  };
}

describe("fault presets", () => {
  it("labels every fault kind the wire can carry", () => {
    for (const kind of KINDS) {
      expect(FAULT_KIND_LABEL[kind]).toBeTruthy();
    }
  });

  it("gives every preset a distinct id and a non-empty profile", () => {
    const ids = FAULT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of FAULT_PRESETS) {
      expect(Object.keys(preset.profile).length).toBeGreaterThan(0);
      expect(preset.hint).toBeTruthy();
    }
  });

  it("keeps every preset within the simulator's validation bounds", () => {
    // Mirrors `faultProfileSchema`: probabilities in [0, 1], durations
    // non-negative integers, max >= min. A preset that 400s is a dead button.
    for (const { profile } of FAULT_PRESETS) {
      if (profile.frozenGps) {
        expect(profile.frozenGps.probability).toBeGreaterThanOrEqual(0);
        expect(profile.frozenGps.probability).toBeLessThanOrEqual(1);
        expect(profile.frozenGps.maxDurationMs).toBeGreaterThanOrEqual(
          profile.frozenGps.minDurationMs
        );
        expect(Number.isInteger(profile.frozenGps.minDurationMs)).toBe(true);
      }
      if (profile.duplicate) {
        expect(profile.duplicate.maxCopies).toBeGreaterThanOrEqual(1);
        expect(profile.duplicate.maxCopies).toBeLessThanOrEqual(10);
      }
      if (profile.battery) {
        expect(profile.battery.initialPercent).toBeLessThanOrEqual(100);
        expect(profile.battery.dieAtPercent).toBeLessThanOrEqual(profile.battery.initialPercent);
      }
      if (profile.outOfOrder) expect(Number.isInteger(profile.outOfOrder.holdMs)).toBe(true);
      if (profile.teleport) expect(profile.teleport.radiusMeters).toBeGreaterThanOrEqual(0);
      if (profile.clockSkew) expect(Number.isInteger(profile.clockSkew.offsetMs)).toBe(true);
    }
  });
});

describe("describeProfile", () => {
  it("summarises each armed group as a percentage or magnitude", () => {
    expect(
      describeProfile({
        frozenGps: { probability: 0.15, minDurationMs: 1000, maxDurationMs: 2000 },
        clockSkew: { offsetMs: -45_000 },
        battery: { initialPercent: 40, drainPercentPerHour: 10, dieAtPercent: 5 },
      })
    ).toBe("freeze 15% · skew -45s · battery 40%");
  });

  it("says so for an empty profile", () => {
    expect(describeProfile({})).toBe("nothing armed");
  });
});

describe("matchPreset", () => {
  it("recognises a profile that came from a preset", () => {
    expect(matchPreset(FAULT_PRESETS[3].profile)?.id).toBe(FAULT_PRESETS[3].id);
  });

  it("does not claim a hand-tuned profile", () => {
    expect(matchPreset({ duplicate: { probability: 0.99, maxCopies: 9 } })).toBeUndefined();
  });

  it("handles an absent profile", () => {
    expect(matchPreset(undefined)).toBeUndefined();
  });
});

describe("countMisbehavingDevices", () => {
  it("counts frozen, dead and spoofing devices", () => {
    const count = countMisbehavingDevices(
      { enabled: true, vehicles: {} },
      status({ frozen: 2, dead: 1, teleporting: 3 })
    );
    expect(count).toBe(6);
  });

  it("ignores in-flight bookkeeping", () => {
    const count = countMisbehavingDevices(
      { enabled: true, vehicles: {} },
      status({ held: 5, queued: 7 })
    );
    expect(count).toBe(0);
  });

  it("reads as zero while the layer is disarmed, even with latched counters", () => {
    const count = countMisbehavingDevices(
      { enabled: false, vehicles: {} },
      status({ frozen: 4, dead: 2 })
    );
    expect(count).toBe(0);
  });

  it("reads as zero before anything has loaded", () => {
    expect(countMisbehavingDevices(null, null)).toBe(0);
    expect(countMisbehavingDevices({ enabled: true, vehicles: {} }, null)).toBe(0);
  });
});
