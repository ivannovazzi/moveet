import { describe, it, expect, vi } from "vitest";
import { DeviceFaultManager } from "../../modules/faults/DeviceFaultManager";
import { parseFaultProfilesEnv } from "../../modules/faults/schema";
import { calculateDistance } from "../../utils/helpers";
import type { DeviceFaultProfile, VehicleDTO } from "../../types";

const T0 = 1_700_000_000_000;

function dto(overrides: Partial<VehicleDTO> = {}): VehicleDTO {
  return {
    id: "v1",
    name: "V1",
    type: "car",
    position: [-1.3, 36.85],
    speed: 40,
    heading: 90,
    ...overrides,
  };
}

/** Manager with a fleet-wide profile armed and a fixed seed. */
function armed(profile: DeviceFaultProfile, seed = 42): DeviceFaultManager {
  return new DeviceFaultManager({ enabled: true, seed, default: profile });
}

describe("DeviceFaultManager", () => {
  // ─── Off by default ───────────────────────────────────────────────

  describe("inactive by default", () => {
    it("passes the DTO through untouched when disabled", () => {
      const manager = new DeviceFaultManager();
      const input = dto();

      const out = manager.report(input, T0);

      expect(manager.isActive()).toBe(false);
      expect(out).toEqual([input]);
      // Same object: no allocation, no timestamp/faults fields on the wire.
      expect(out[0]).toBe(input);
    });

    it("passes the DTO through when enabled but no profile is configured", () => {
      const manager = new DeviceFaultManager({ enabled: true, seed: 1 });
      const input = dto();

      expect(manager.isActive()).toBe(false);
      expect(manager.report(input, T0)[0]).toBe(input);
      expect(manager.view(input, T0)).toBe(input);
    });

    it("is active once a profile exists and stays inactive while disabled", () => {
      const profile: DeviceFaultProfile = { clockSkew: { offsetMs: 1 } };
      expect(new DeviceFaultManager({ default: profile }).isActive()).toBe(false);
      expect(new DeviceFaultManager({ enabled: true, default: profile }).isActive()).toBe(true);
      expect(new DeviceFaultManager({ enabled: true, vehicles: { v1: profile } }).isActive()).toBe(
        true
      );
    });
  });

  // ─── Frozen GPS ───────────────────────────────────────────────────

  describe("frozen_gps", () => {
    it("latches the fix and replays it for the frozen window", () => {
      const manager = armed({
        frozenGps: { probability: 1, minDurationMs: 5000, maxDurationMs: 5000 },
      });

      const first = manager.report(dto(), T0)[0]!;
      expect(first.faults?.active).toContain("frozen_gps");
      expect(first.position).toEqual([-1.3, 36.85]);

      // The vehicle really moved, but the device keeps reporting the latched fix.
      const moved = dto({ position: [-1.31, 36.86], speed: 55, heading: 180 });
      const second = manager.report(moved, T0 + 1000)[0]!;
      expect(second.position).toEqual([-1.3, 36.85]);
      expect(second.speed).toBe(40);
      expect(second.heading).toBe(90);
      expect(second.faults?.active).toContain("frozen_gps");
    });

    it("re-latches on the current fix once the window expires", () => {
      const manager = armed({
        frozenGps: { probability: 1, minDurationMs: 5000, maxDurationMs: 5000 },
      });
      manager.report(dto(), T0);

      const moved = dto({ position: [-1.31, 36.86] });
      const after = manager.report(moved, T0 + 6000)[0]!;

      expect(after.position).toEqual([-1.31, 36.86]);
      expect(manager.getStatus().counts.frozen_gps).toBe(2);
    });

    it("never freezes at probability 0", () => {
      const manager = armed({
        frozenGps: { probability: 0, minDurationMs: 1000, maxDurationMs: 1000 },
      });

      const out = manager.report(dto(), T0)[0]!;

      expect(out.faults?.active).toEqual([]);
      expect(manager.getStatus().counts.frozen_gps).toBe(0);
    });
  });

  // ─── Clock skew ───────────────────────────────────────────────────

  describe("clock_skew", () => {
    it("stamps the sample with the device's wrong clock", () => {
      const manager = armed({ clockSkew: { offsetMs: 5000 } });

      const out = manager.report(dto(), T0)[0]!;

      expect(out.timestamp).toBe(T0 + 5000);
      expect(out.faults).toMatchObject({ active: ["clock_skew"], skewMs: 5000 });
    });

    it("accumulates drift with device uptime", () => {
      const manager = armed({ clockSkew: { offsetMs: 0, driftMsPerMinute: 60 } });
      // First report sets the device's birth time; skew is 0 there.
      const first = manager.report(dto(), T0)[0]!;
      expect(first.timestamp).toBe(T0);
      expect(first.faults?.active).toEqual([]);

      const later = manager.report(dto(), T0 + 120_000)[0]!;

      expect(later.faults?.skewMs).toBe(120);
      expect(later.timestamp).toBe(T0 + 120_000 + 120);
    });

    it("carries the true emit time when no clock fault is armed", () => {
      const manager = armed({ duplicate: { probability: 0, maxCopies: 1 } });

      expect(manager.report(dto(), T0)[0]!.timestamp).toBe(T0);
    });
  });

  // ─── Duplicate ────────────────────────────────────────────────────

  describe("duplicate", () => {
    it("retransmits the sample it just sent", () => {
      const manager = armed({ duplicate: { probability: 1, maxCopies: 1 } });

      const out = manager.report(dto(), T0);

      expect(out).toHaveLength(2);
      expect(out[1]!.position).toEqual(out[0]!.position);
      expect(out[1]!.timestamp).toBe(out[0]!.timestamp);
      expect(out[1]!.faults?.active).toContain("duplicate");
      expect(out[0]!.faults?.active).not.toContain("duplicate");
      expect(manager.getStatus().counts.duplicate).toBe(1);
    });

    it("emits at most maxCopies extra copies", () => {
      const manager = armed({ duplicate: { probability: 1, maxCopies: 3 } });

      for (let i = 0; i < 20; i++) {
        const out = manager.report(dto(), T0 + i * 1000);
        expect(out.length).toBeGreaterThanOrEqual(2);
        expect(out.length).toBeLessThanOrEqual(4);
      }
    });
  });

  // ─── Out of order ─────────────────────────────────────────────────

  describe("out_of_order", () => {
    it("withholds a sample and releases it behind a newer one", () => {
      const manager = armed({ outOfOrder: { probability: 1, holdMs: 1000 } });

      // Nothing goes out: the device is sitting on this sample.
      expect(manager.report(dto(), T0)).toEqual([]);
      expect(manager.getStatus().held).toBe(1);

      const released = manager.report(dto({ position: [-1.31, 36.86] }), T0 + 1000);

      expect(released).toHaveLength(2);
      // Newer sample first, older one behind it: out of order by timestamp.
      expect(released[0]!.timestamp).toBe(T0 + 1000);
      expect(released[1]!.timestamp).toBe(T0);
      expect(released[1]!.faults?.active).toContain("out_of_order");
      expect(manager.getStatus().held).toBe(0);
    });

    it("keeps emitting normally while a sample is still withheld", () => {
      const manager = armed({ outOfOrder: { probability: 1, holdMs: 10_000 } });
      manager.report(dto(), T0);

      const out = manager.report(dto(), T0 + 1000);

      expect(out).toHaveLength(1);
      expect(out[0]!.timestamp).toBe(T0 + 1000);
      expect(manager.getStatus().held).toBe(1);
    });
  });

  // ─── Battery death ────────────────────────────────────────────────

  describe("battery_dead", () => {
    const battery = { initialPercent: 100, drainPercentPerHour: 100, dieAtPercent: 50 };

    it("reports a draining battery while alive", () => {
      const manager = armed({ battery });
      manager.report(dto(), T0);

      const out = manager.report(dto(), T0 + 900_000)[0]!;

      expect(out.faults?.battery).toBe(75);
      expect(out.faults?.active).toEqual([]);
    });

    it("goes silent once the battery dies", () => {
      const manager = armed({ battery });
      manager.report(dto(), T0);

      expect(manager.report(dto(), T0 + 1_800_000)).toEqual([]);
      const status = manager.getStatus();
      expect(status.dead).toBe(1);
      expect(status.counts.battery_dead).toBe(1);
      // Death is counted once, not once per silent tick.
      manager.report(dto(), T0 + 1_900_000);
      expect(manager.getStatus().counts.battery_dead).toBe(1);
    });

    it("shows the last fix a dead device managed to send", () => {
      const manager = armed({ battery });
      manager.report(dto({ position: [-1.2, 36.8] }), T0);
      manager.report(dto(), T0 + 1_800_000);

      const view = manager.view(dto({ position: [-1.31, 36.86] }), T0 + 1_800_000);

      expect(view.position).toEqual([-1.2, 36.8]);
      expect(view.faults?.active).toContain("battery_dead");
      expect(view.faults?.battery).toBe(0);
    });
  });

  // ─── Teleport ─────────────────────────────────────────────────────

  describe("teleport", () => {
    it("moves the reported fix within the configured radius", () => {
      const manager = armed({ teleport: { probability: 1, radiusMeters: 1000, holdMs: 0 } });

      const out = manager.report(dto(), T0)[0]!;

      expect(out.faults?.active).toContain("teleport");
      const offsetKm = calculateDistance([-1.3, 36.85], out.position);
      expect(offsetKm).toBeLessThanOrEqual(1.001);
    });

    it("holds the bogus offset for holdMs, then draws a new one", () => {
      const manager = armed({ teleport: { probability: 1, radiusMeters: 1000, holdMs: 5000 } });

      const first = manager.report(dto(), T0)[0]!;
      const during = manager.report(dto(), T0 + 1000)[0]!;
      expect(during.position).toEqual(first.position);

      const after = manager.report(dto(), T0 + 6000)[0]!;
      expect(after.position).not.toEqual(first.position);
      expect(manager.getStatus().counts.teleport).toBe(2);
    });
  });

  // ─── Reproducibility ──────────────────────────────────────────────

  describe("reproducibility under a fixed seed", () => {
    const noisy: DeviceFaultProfile = {
      frozenGps: { probability: 0.4, minDurationMs: 500, maxDurationMs: 3000 },
      teleport: { probability: 0.3, radiusMeters: 500, holdMs: 1000 },
      duplicate: { probability: 0.3, maxCopies: 2 },
      outOfOrder: { probability: 0.2, holdMs: 1500 },
      clockSkew: { offsetMs: 250, driftMsPerMinute: 10 },
    };

    function run(seed: number, vehicleId = "v1"): string {
      const manager = armed(noisy, seed);
      const samples: VehicleDTO[] = [];
      for (let i = 0; i < 100; i++) {
        samples.push(
          ...manager.report(
            dto({ id: vehicleId, position: [-1.3 + i * 1e-4, 36.85] }),
            T0 + i * 500
          )
        );
      }
      return JSON.stringify(samples);
    }

    it("produces an identical sample stream for the same seed", () => {
      expect(run(7)).toBe(run(7));
    });

    it("produces a different stream for a different seed", () => {
      expect(run(7)).not.toBe(run(8));
    });

    it("gives each device its own stream, so fleet order cannot matter", () => {
      expect(run(7, "v1")).not.toBe(run(7, "v2").replaceAll('"v2"', '"v1"'));
    });

    it("is unseeded (and so not reproducible) when no seed is configured", () => {
      const manager = new DeviceFaultManager({
        enabled: true,
        default: { teleport: { probability: 1, radiusMeters: 1000, holdMs: 0 } },
      });
      const randomSpy = vi.spyOn(Math, "random");

      manager.report(dto(), T0);

      expect(randomSpy).toHaveBeenCalled();
      randomSpy.mockRestore();
    });
  });

  // ─── view() ───────────────────────────────────────────────────────

  describe("view", () => {
    it("projects a frozen device without advancing fault state", () => {
      const manager = armed({
        frozenGps: { probability: 1, minDurationMs: 5000, maxDurationMs: 5000 },
      });
      manager.report(dto(), T0);

      const moved = dto({ position: [-1.31, 36.86] });
      expect(manager.view(moved, T0 + 1000).position).toEqual([-1.3, 36.85]);
      // Still one frozen window, not two: view() drew no random numbers.
      expect(manager.getStatus().counts.frozen_gps).toBe(1);
    });

    it("leaves an unknown device's DTO alone", () => {
      const manager = armed({ clockSkew: { offsetMs: 100 } });
      const input = dto();

      expect(manager.view(input, T0)).toBe(input);
    });

    it("does not perturb the RNG stream the reports draw from", () => {
      const profile: DeviceFaultProfile = {
        teleport: { probability: 0.5, radiusMeters: 500, holdMs: 0 },
      };
      const withViews = armed(profile);
      const withoutViews = armed(profile);

      const a: VehicleDTO[] = [];
      const b: VehicleDTO[] = [];
      for (let i = 0; i < 20; i++) {
        a.push(...withViews.report(dto(), T0 + i * 1000));
        withViews.view(dto(), T0 + i * 1000);
        withViews.view(dto(), T0 + i * 1000);
        b.push(...withoutViews.report(dto(), T0 + i * 1000));
      }

      expect(a).toEqual(b);
    });
  });

  // ─── Profiles & configuration ─────────────────────────────────────

  describe("profiles", () => {
    it("prefers a per-vehicle profile over the fleet-wide default", () => {
      const manager = new DeviceFaultManager({
        enabled: true,
        seed: 1,
        default: { clockSkew: { offsetMs: 1000 } },
        vehicles: { v1: { clockSkew: { offsetMs: 9000 } } },
      });

      expect(manager.report(dto({ id: "v1" }), T0)[0]!.faults?.skewMs).toBe(9000);
      expect(manager.report(dto({ id: "v2" }), T0)[0]!.faults?.skewMs).toBe(1000);
    });

    it("sets and clears a per-vehicle profile at runtime", () => {
      const manager = new DeviceFaultManager({ enabled: true, seed: 1 });

      manager.setVehicleProfile("v1", { clockSkew: { offsetMs: 3000 } });
      expect(manager.isActive()).toBe(true);
      expect(manager.report(dto(), T0)[0]!.faults?.skewMs).toBe(3000);

      expect(manager.clearVehicleProfile("v1")).toBe(true);
      expect(manager.clearVehicleProfile("v1")).toBe(false);
      expect(manager.isActive()).toBe(false);
    });

    it("drops the device's latched state when its profile is replaced", () => {
      const manager = armed({
        frozenGps: { probability: 1, minDurationMs: 60_000, maxDurationMs: 60_000 },
      });
      manager.report(dto(), T0);
      expect(manager.getStatus().frozen).toBe(1);

      manager.setVehicleProfile("v1", { clockSkew: { offsetMs: 1 } });

      expect(manager.getStatus().devices).toBe(0);
    });
  });

  describe("configure", () => {
    it("flips enabled without restating the profiles", () => {
      const manager = new DeviceFaultManager({ default: { clockSkew: { offsetMs: 100 } } });

      const config = manager.configure({ enabled: true });

      expect(config.enabled).toBe(true);
      expect(config.default).toEqual({ clockSkew: { offsetMs: 100 } });
      expect(manager.isActive()).toBe(true);
    });

    it("clears the fleet-wide default with an explicit null", () => {
      const manager = armed({ clockSkew: { offsetMs: 100 } });

      const config = manager.configure({ default: null });

      expect(config.default).toBeUndefined();
      expect(manager.isActive()).toBe(false);
    });

    it("discards device state when the seed changes", () => {
      const manager = armed({
        frozenGps: { probability: 1, minDurationMs: 60_000, maxDurationMs: 60_000 },
      });
      manager.report(dto(), T0);
      expect(manager.getStatus().devices).toBe(1);

      manager.configure({ seed: 99 });

      expect(manager.getStatus().devices).toBe(0);
      expect(manager.getConfig().seed).toBe(99);
    });

    it("discards device state when disabled, so a re-enable starts clean", () => {
      const manager = armed({
        battery: { initialPercent: 10, drainPercentPerHour: 100, dieAtPercent: 5 },
      });
      manager.report(dto(), T0);

      manager.configure({ enabled: false });
      manager.configure({ enabled: true });

      expect(manager.getStatus().devices).toBe(0);
      expect(manager.report(dto(), T0)[0]!.faults?.battery).toBe(10);
    });

    it("emits faults:config on every configuration change", () => {
      const manager = new DeviceFaultManager();
      const listener = vi.fn();
      manager.on("faults:config", listener);

      manager.configure({ enabled: true, default: { clockSkew: { offsetMs: 1 } } });
      manager.setVehicleProfile("v1", { clockSkew: { offsetMs: 2 } });
      manager.clearVehicleProfile("v1");

      expect(listener).toHaveBeenCalledTimes(3);
      expect(listener.mock.calls[0]![0]).toMatchObject({ enabled: true });
    });

    it("merges per-vehicle profiles rather than replacing the whole map", () => {
      const manager = new DeviceFaultManager({
        enabled: true,
        seed: 1,
        vehicles: { v1: { clockSkew: { offsetMs: 1 } } },
      });

      const config = manager.configure({ vehicles: { v2: { clockSkew: { offsetMs: 2 } } } });

      expect(Object.keys(config.vehicles).sort()).toEqual(["v1", "v2"]);
    });
  });

  // ─── Egress queue ─────────────────────────────────────────────────

  describe("drainTelemetry", () => {
    it("hands over every emitted sample in order, then empties", () => {
      const manager = armed({ duplicate: { probability: 1, maxCopies: 1 } });
      manager.report(dto(), T0);
      manager.report(dto(), T0 + 1000);

      const drained = manager.drainTelemetry();

      expect(drained).toHaveLength(4);
      expect(drained.map((s) => s.timestamp)).toEqual([T0, T0, T0 + 1000, T0 + 1000]);
      expect(manager.drainTelemetry()).toEqual([]);
      expect(manager.getStatus().queued).toBe(0);
    });

    it("queues nothing for a silent device", () => {
      const manager = armed({ outOfOrder: { probability: 1, holdMs: 60_000 } });

      manager.report(dto(), T0);

      expect(manager.drainTelemetry()).toEqual([]);
    });

    it("bounds the queue and drops the oldest samples on overflow", () => {
      const manager = armed({ clockSkew: { offsetMs: 1 } });

      for (let i = 0; i < 10_100; i++) manager.report(dto(), T0 + i);

      expect(manager.getStatus().queued).toBe(10_000);
      expect(manager.getDroppedCount()).toBe(100);
      // The oldest 100 went; the queue starts at the 101st sample.
      expect(manager.drainTelemetry()[0]!.timestamp).toBe(T0 + 100 + 1);
    });
  });

  // ─── Reset ────────────────────────────────────────────────────────

  describe("reset", () => {
    it("clears device state and counters but keeps the configuration", () => {
      const manager = armed({
        frozenGps: { probability: 1, minDurationMs: 60_000, maxDurationMs: 60_000 },
      });
      manager.report(dto(), T0);

      manager.reset();

      const status = manager.getStatus();
      expect(status.devices).toBe(0);
      expect(status.queued).toBe(0);
      expect(status.counts.frozen_gps).toBe(0);
      expect(manager.isActive()).toBe(true);
      expect(manager.getConfig().default).toBeDefined();
    });
  });
});

// ─── FAULT_PROFILES env parsing ─────────────────────────────────────

describe("parseFaultProfilesEnv", () => {
  it("returns an empty config for an empty value", () => {
    expect(parseFaultProfilesEnv("")).toEqual({});
    expect(parseFaultProfilesEnv("   ")).toEqual({});
  });

  it("parses a default profile and per-vehicle overrides", () => {
    const parsed = parseFaultProfilesEnv(
      '{"default":{"clockSkew":{"offsetMs":500}},"vehicles":{"v1":{"duplicate":{"probability":0.5,"maxCopies":2}}}}'
    );

    expect(parsed.default).toEqual({ clockSkew: { offsetMs: 500 } });
    expect(parsed.vehicles?.v1).toEqual({ duplicate: { probability: 0.5, maxCopies: 2 } });
  });

  it("throws on malformed JSON", () => {
    expect(() => parseFaultProfilesEnv("{nope")).toThrow(/not valid JSON/);
  });

  it("throws on an unknown key, rather than silently arming nothing", () => {
    expect(() => parseFaultProfilesEnv('{"default":{"frozenGPS":{"probability":1}}}')).toThrow(
      /Invalid FAULT_PROFILES/
    );
  });

  it("rejects an out-of-range probability", () => {
    expect(() =>
      parseFaultProfilesEnv('{"default":{"duplicate":{"probability":2,"maxCopies":1}}}')
    ).toThrow(/Invalid FAULT_PROFILES/);
  });

  it("rejects a frozen window whose max is below its min", () => {
    expect(() =>
      parseFaultProfilesEnv(
        '{"default":{"frozenGps":{"probability":1,"minDurationMs":5000,"maxDurationMs":1000}}}'
      )
    ).toThrow(/maxDurationMs must be >= minDurationMs/);
  });
});
