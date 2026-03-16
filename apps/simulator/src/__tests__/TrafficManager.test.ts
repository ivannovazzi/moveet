import { describe, it, expect } from "vitest";
import { TrafficManager } from "../modules/TrafficManager";
import { SimulationClock } from "../modules/SimulationClock";
import { getDemandMultiplier, DEFAULT_TRAFFIC_PROFILE } from "../utils/trafficProfiles";

function middayClock() {
  return new SimulationClock({ startHour: 12 });
}

describe("TrafficManager", () => {
  it("should track edge occupancy", () => {
    const tm = new TrafficManager(middayClock());
    tm.enter("edge-1");
    tm.enter("edge-1");
    expect(tm.getCongestionFactor("edge-1", 0.1)).toBeLessThan(1);
  });

  it("should return 1.0 for empty edges", () => {
    const tm = new TrafficManager(middayClock());
    expect(tm.getCongestionFactor("edge-1", 0.1)).toBe(1);
  });

  it("should decrease congestion factor as occupancy increases", () => {
    const tm = new TrafficManager(middayClock());
    const f0 = tm.getCongestionFactor("edge-1", 0.1);
    tm.enter("edge-1");
    const f1 = tm.getCongestionFactor("edge-1", 0.1);
    tm.enter("edge-1");
    const f2 = tm.getCongestionFactor("edge-1", 0.1);
    expect(f0).toBeGreaterThan(f1);
    expect(f1).toBeGreaterThan(f2);
  });

  it("should restore congestion factor when vehicles leave", () => {
    const tm = new TrafficManager(middayClock());
    tm.enter("edge-1");
    tm.enter("edge-1");
    tm.leave("edge-1");
    tm.leave("edge-1");
    expect(tm.getCongestionFactor("edge-1", 0.1)).toBe(1);
  });

  it("should not go below 0.2", () => {
    const tm = new TrafficManager(middayClock());
    for (let i = 0; i < 100; i++) tm.enter("edge-1");
    expect(tm.getCongestionFactor("edge-1", 0.05)).toBeGreaterThanOrEqual(0.2);
  });
});

describe("TrafficManager - BPR formula verification", () => {
  it("empty edge should have factor exactly 1.0", () => {
    const tm = new TrafficManager(middayClock());
    expect(tm.getCongestionFactor("edge-x", 0.1)).toBe(1.0);
    expect(tm.getCongestionFactor("edge-x", 1.0)).toBe(1.0);
    expect(tm.getCongestionFactor("edge-x", 0.01)).toBe(1.0);
  });

  it("1 vehicle on 0.1km edge (capacity=2) should yield factor ~0.8", () => {
    const tm = new TrafficManager(middayClock());
    tm.enter("edge-1");
    const factor = tm.getCongestionFactor("edge-1", 0.1);
    // capacity = max(1, 0.1*20) = 2, ratio = 1/2 = 0.5
    // factor = 1/(1+0.25) = 0.8
    expect(factor).toBeCloseTo(0.8, 5);
  });

  it("at capacity (2 vehicles on 0.1km edge) factor should be 0.5", () => {
    const tm = new TrafficManager(middayClock());
    tm.enter("edge-1");
    tm.enter("edge-1");
    const factor = tm.getCongestionFactor("edge-1", 0.1);
    // ratio = 2/2 = 1.0, factor = 1/(1+1) = 0.5
    expect(factor).toBeCloseTo(0.5, 5);
    expect(factor).toBeLessThan(0.5 + 0.001);
  });

  it("over capacity: factor approaches but never goes below 0.2", () => {
    const tm = new TrafficManager(middayClock());
    // 0.1km edge, capacity=2, add 10 vehicles -> ratio=5, factor=1/(1+25)=0.0385 -> clamped to 0.2
    for (let i = 0; i < 10; i++) tm.enter("edge-1");
    const factor = tm.getCongestionFactor("edge-1", 0.1);
    expect(factor).toBe(0.2);

    // Add even more vehicles, still should be 0.2
    for (let i = 0; i < 50; i++) tm.enter("edge-1");
    expect(tm.getCongestionFactor("edge-1", 0.1)).toBe(0.2);
  });
});

describe("TrafficManager - Edge independence", () => {
  it("congestion on edge-1 should not affect edge-2", () => {
    const tm = new TrafficManager(middayClock());
    // Heavily congest edge-1
    for (let i = 0; i < 20; i++) tm.enter("edge-1");
    // edge-2 stays empty
    tm.enter("edge-2");

    const factor1 = tm.getCongestionFactor("edge-1", 0.1);
    const factor2 = tm.getCongestionFactor("edge-2", 0.1);

    expect(factor1).toBe(0.2); // heavily congested
    expect(factor2).toBeCloseTo(0.8, 5); // only 1 vehicle, capacity=2
    expect(factor2).toBeGreaterThan(factor1);
  });
});

describe("TrafficManager - Leave edge cases", () => {
  it("leave on an edge with 0 vehicles should not go negative", () => {
    const tm = new TrafficManager(middayClock());
    tm.leave("edge-empty");
    // After leaving an empty edge, factor should still be 1.0 (0 vehicles)
    expect(tm.getCongestionFactor("edge-empty", 0.1)).toBe(1.0);
  });

  it("leave more times than enter should keep occupancy at 0 and factor at 1.0", () => {
    const tm = new TrafficManager(middayClock());
    tm.enter("edge-1");
    tm.leave("edge-1");
    tm.leave("edge-1");
    tm.leave("edge-1");
    expect(tm.getCongestionFactor("edge-1", 0.1)).toBe(1.0);
  });

  it("enter 5 times then leave 5 times should return factor to 1.0", () => {
    const tm = new TrafficManager(middayClock());
    for (let i = 0; i < 5; i++) tm.enter("edge-1");
    expect(tm.getCongestionFactor("edge-1", 0.1)).toBeLessThan(1.0);
    for (let i = 0; i < 5; i++) tm.leave("edge-1");
    expect(tm.getCongestionFactor("edge-1", 0.1)).toBe(1.0);
  });
});

describe("TrafficManager - Capacity scaling with distance", () => {
  it("short edge (0.01km, capacity clamped to 1) should congest with 1 vehicle", () => {
    const tm = new TrafficManager(middayClock());
    tm.enter("short-edge");
    // capacity = max(1, 0.01*20) = max(1, 0.2) = 1, ratio = 1/1 = 1.0
    // factor = 1/(1+1) = 0.5
    const factor = tm.getCongestionFactor("short-edge", 0.01);
    expect(factor).toBeCloseTo(0.5, 5);
  });

  it("long edge (1km, capacity=20) should barely congest with 1 vehicle", () => {
    const tm = new TrafficManager(middayClock());
    tm.enter("long-edge");
    // capacity = max(1, 1*20) = 20, ratio = 1/20 = 0.05
    // factor = 1/(1+0.0025) = ~0.9975
    const factor = tm.getCongestionFactor("long-edge", 1.0);
    expect(factor).toBeGreaterThan(0.99);
    expect(factor).toBeCloseTo(1 / (1 + 0.0025), 4);
  });

  it("shorter edges should congest faster than longer ones for same vehicle count", () => {
    const tm = new TrafficManager(middayClock());
    tm.enter("short");
    tm.enter("long");
    const shortFactor = tm.getCongestionFactor("short", 0.01);
    const longFactor = tm.getCongestionFactor("long", 1.0);
    expect(shortFactor).toBeLessThan(longFactor);
  });
});

describe("TrafficManager - Multiple vehicles entering and leaving", () => {
  it("10 vehicles enter then 5 leave: check intermediate factor", () => {
    const tm = new TrafficManager(middayClock());
    for (let i = 0; i < 10; i++) tm.enter("edge-1");
    // capacity = max(1, 0.5*20) = 10, ratio = 10/10 = 1.0
    // factor = 1/(1+1) = 0.5
    const factorFull = tm.getCongestionFactor("edge-1", 0.5);
    expect(factorFull).toBeCloseTo(0.5, 5);

    for (let i = 0; i < 5; i++) tm.leave("edge-1");
    // ratio = 5/10 = 0.5, factor = 1/(1+0.25) = 0.8
    const factorHalf = tm.getCongestionFactor("edge-1", 0.5);
    expect(factorHalf).toBeCloseTo(0.8, 5);
    expect(factorHalf).toBeGreaterThan(factorFull);
  });

  it("factor is monotonically decreasing as vehicles enter", () => {
    const tm = new TrafficManager(middayClock());
    let prevFactor = tm.getCongestionFactor("edge-1", 0.1);
    for (let i = 0; i < 8; i++) {
      tm.enter("edge-1");
      const currentFactor = tm.getCongestionFactor("edge-1", 0.1);
      expect(currentFactor).toBeLessThanOrEqual(prevFactor);
      prevFactor = currentFactor;
    }
    // After 8 entries, factor should be significantly lower than 1.0
    expect(prevFactor).toBeLessThan(0.5);
  });

  it("factor is monotonically increasing as vehicles leave", () => {
    const tm = new TrafficManager(middayClock());
    // Enter 8 vehicles first
    for (let i = 0; i < 8; i++) tm.enter("edge-1");

    let prevFactor = tm.getCongestionFactor("edge-1", 0.1);
    for (let i = 0; i < 8; i++) {
      tm.leave("edge-1");
      const currentFactor = tm.getCongestionFactor("edge-1", 0.1);
      expect(currentFactor).toBeGreaterThanOrEqual(prevFactor);
      prevFactor = currentFactor;
    }
    // After all leave, factor should be back to 1.0
    expect(prevFactor).toBe(1.0);
  });
});

describe("TrafficManager - time-varying demand", () => {
  it("rush hour multiplies effective occupancy on trunk/primary roads", () => {
    // At 8am (morning_rush), demand=2.0 on primary roads
    // 1 vehicle on 0.1km primary edge (capacity=2) → effectiveOccupancy=2 → ratio=1.0 → factor=0.5
    const clock = new SimulationClock({ startHour: 8 });
    const tm = new TrafficManager(clock);
    tm.enter("edge-1");
    expect(tm.getCongestionFactor("edge-1", 0.1, "primary")).toBeCloseTo(0.5, 5);
  });

  it("rush hour has no effect on residential roads", () => {
    // At 8am, demand=1.0 on residential (not in affectedHighways)
    // 1 vehicle on 0.1km residential (capacity=2) → ratio=0.5 → factor=0.8 (same as midday)
    const clock = new SimulationClock({ startHour: 8 });
    const tm = new TrafficManager(clock);
    tm.enter("edge-1");
    expect(tm.getCongestionFactor("edge-1", 0.1, "residential")).toBeCloseTo(0.8, 5);
  });

  it("night reduces effective occupancy on all roads", () => {
    // At 2am, demand=0.3 on all roads
    // 1 vehicle on 0.1km primary (capacity=2) → effectiveOccupancy=0.3 → ratio=0.15 → factor=1/(1+0.0225)≈0.978
    const clock = new SimulationClock({ startHour: 2 });
    const tm = new TrafficManager(clock);
    tm.enter("edge-1");
    const factor = tm.getCongestionFactor("edge-1", 0.1, "primary");
    expect(factor).toBeGreaterThan(0.97);
    expect(factor).toBeLessThan(1.0);
  });

  it("congestion factor updates when clock advances to rush hour", () => {
    // Start at midday (hour 12), advance to morning rush (hour 7 next day)
    const clock = new SimulationClock({ startHour: 12 });
    const tm = new TrafficManager(clock);
    tm.enter("edge-1");

    const middayFactor = tm.getCongestionFactor("edge-1", 0.1, "primary");

    // Advance clock to next day morning rush (tick forward 19 hours at 1x)
    clock.tick(19 * 3_600_000);

    const rushFactor = tm.getCongestionFactor("edge-1", 0.1, "primary");

    // Rush hour should have higher effective occupancy → lower factor
    expect(rushFactor).toBeLessThan(middayFactor);
  });

  it("evening rush has stronger effect than morning rush", () => {
    // Evening rush: demandMultiplier=2.5 vs morning=2.0
    const morningClock = new SimulationClock({ startHour: 8 });
    const eveningClock = new SimulationClock({ startHour: 18 });
    const tmMorning = new TrafficManager(morningClock);
    const tmEvening = new TrafficManager(eveningClock);
    tmMorning.enter("edge-1");
    tmEvening.enter("edge-1");

    const morningFactor = tmMorning.getCongestionFactor("edge-1", 0.1, "primary");
    const eveningFactor = tmEvening.getCongestionFactor("edge-1", 0.1, "primary");

    expect(eveningFactor).toBeLessThan(morningFactor);
  });

  it("getProfile returns the current profile", () => {
    const tm = new TrafficManager(new SimulationClock({ startHour: 12 }));
    const profile = tm.getProfile();
    expect(profile.name).toBe("default");
    expect(profile.timeRanges.length).toBeGreaterThan(0);
  });

  it("setProfile replaces the active profile", () => {
    const clock = new SimulationClock({ startHour: 8 });
    const tm = new TrafficManager(clock);
    tm.enter("edge-1");

    // With default profile, rush hour at 8am on primary = demand 2.0
    const defaultFactor = tm.getCongestionFactor("edge-1", 0.1, "primary");

    // Set a flat profile (no time variation)
    tm.setProfile({ name: "flat", timeRanges: [] });
    const flatFactor = tm.getCongestionFactor("edge-1", 0.1, "primary");

    // Flat profile → demand=1.0 → more lenient than rush hour
    expect(flatFactor).toBeGreaterThan(defaultFactor);
  });
});

describe("trafficProfiles - getDemandMultiplier", () => {
  it("returns 2.0 for primary at hour 8 (morning_rush)", () => {
    expect(getDemandMultiplier(DEFAULT_TRAFFIC_PROFILE, 8, "primary")).toBe(2.0);
  });

  it("returns 2.0 for trunk at hour 7 (morning_rush start)", () => {
    expect(getDemandMultiplier(DEFAULT_TRAFFIC_PROFILE, 7, "trunk")).toBe(2.0);
  });

  it("returns 1.0 for primary at hour 9 (morning_rush end, exclusive)", () => {
    expect(getDemandMultiplier(DEFAULT_TRAFFIC_PROFILE, 9, "primary")).toBe(1.0);
  });

  it("returns 2.5 for primary at hour 17 (evening_rush)", () => {
    expect(getDemandMultiplier(DEFAULT_TRAFFIC_PROFILE, 17, "primary")).toBe(2.5);
  });

  it("returns 2.5 for trunk at hour 18 (evening_rush)", () => {
    expect(getDemandMultiplier(DEFAULT_TRAFFIC_PROFILE, 18, "trunk")).toBe(2.5);
  });

  it("returns 1.0 for primary at hour 19 (evening_rush end, exclusive)", () => {
    expect(getDemandMultiplier(DEFAULT_TRAFFIC_PROFILE, 19, "primary")).toBe(1.0);
  });

  it("returns 0.3 for primary at hour 22 (night)", () => {
    expect(getDemandMultiplier(DEFAULT_TRAFFIC_PROFILE, 22, "primary")).toBe(0.3);
  });

  it("returns 0.3 for primary at hour 2 (night)", () => {
    expect(getDemandMultiplier(DEFAULT_TRAFFIC_PROFILE, 2, "primary")).toBe(0.3);
  });

  it("returns 0.3 for residential at hour 2 (night affects all roads)", () => {
    expect(getDemandMultiplier(DEFAULT_TRAFFIC_PROFILE, 2, "residential")).toBe(0.3);
  });

  it("returns 1.0 for primary at hour 12 (midday)", () => {
    expect(getDemandMultiplier(DEFAULT_TRAFFIC_PROFILE, 12, "primary")).toBe(1.0);
  });

  it("returns 1.0 for residential at hour 8 (rush hours only affect trunk/primary)", () => {
    expect(getDemandMultiplier(DEFAULT_TRAFFIC_PROFILE, 8, "residential")).toBe(1.0);
  });

  it("returns 1.0 for secondary at hour 17 (rush hours only affect trunk/primary)", () => {
    expect(getDemandMultiplier(DEFAULT_TRAFFIC_PROFILE, 17, "secondary")).toBe(1.0);
  });

  it("returns 1.0 for an empty profile at any hour", () => {
    const emptyProfile = { name: "empty", timeRanges: [] };
    expect(getDemandMultiplier(emptyProfile, 8, "primary")).toBe(1.0);
    expect(getDemandMultiplier(emptyProfile, 2, "residential")).toBe(1.0);
  });
});
