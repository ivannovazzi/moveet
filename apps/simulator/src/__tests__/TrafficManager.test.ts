import { describe, it, expect } from "vitest";
import { TrafficManager } from "../modules/TrafficManager";

describe("TrafficManager", () => {
  it("should track edge occupancy", () => {
    const tm = new TrafficManager();
    tm.enter("edge-1");
    tm.enter("edge-1");
    expect(tm.getCongestionFactor("edge-1", 0.1)).toBeLessThan(1);
  });

  it("should return 1.0 for empty edges", () => {
    const tm = new TrafficManager();
    expect(tm.getCongestionFactor("edge-1", 0.1)).toBe(1);
  });

  it("should decrease congestion factor as occupancy increases", () => {
    const tm = new TrafficManager();
    const f0 = tm.getCongestionFactor("edge-1", 0.1);
    tm.enter("edge-1");
    const f1 = tm.getCongestionFactor("edge-1", 0.1);
    tm.enter("edge-1");
    const f2 = tm.getCongestionFactor("edge-1", 0.1);
    expect(f0).toBeGreaterThan(f1);
    expect(f1).toBeGreaterThan(f2);
  });

  it("should restore congestion factor when vehicles leave", () => {
    const tm = new TrafficManager();
    tm.enter("edge-1");
    tm.enter("edge-1");
    tm.leave("edge-1");
    tm.leave("edge-1");
    expect(tm.getCongestionFactor("edge-1", 0.1)).toBe(1);
  });

  it("should not go below 0.2", () => {
    const tm = new TrafficManager();
    for (let i = 0; i < 100; i++) tm.enter("edge-1");
    expect(tm.getCongestionFactor("edge-1", 0.05)).toBeGreaterThanOrEqual(0.2);
  });
});

describe("TrafficManager - BPR formula verification", () => {
  it("empty edge should have factor exactly 1.0", () => {
    const tm = new TrafficManager();
    expect(tm.getCongestionFactor("edge-x", 0.1)).toBe(1.0);
    expect(tm.getCongestionFactor("edge-x", 1.0)).toBe(1.0);
    expect(tm.getCongestionFactor("edge-x", 0.01)).toBe(1.0);
  });

  it("1 vehicle on 0.1km edge (capacity=2) should yield factor ~0.8", () => {
    const tm = new TrafficManager();
    tm.enter("edge-1");
    const factor = tm.getCongestionFactor("edge-1", 0.1);
    // capacity = max(1, 0.1*20) = 2, ratio = 1/2 = 0.5
    // factor = 1/(1+0.25) = 0.8
    expect(factor).toBeCloseTo(0.8, 5);
  });

  it("at capacity (2 vehicles on 0.1km edge) factor should be 0.5", () => {
    const tm = new TrafficManager();
    tm.enter("edge-1");
    tm.enter("edge-1");
    const factor = tm.getCongestionFactor("edge-1", 0.1);
    // ratio = 2/2 = 1.0, factor = 1/(1+1) = 0.5
    expect(factor).toBeCloseTo(0.5, 5);
    expect(factor).toBeLessThan(0.5 + 0.001);
  });

  it("over capacity: factor approaches but never goes below 0.2", () => {
    const tm = new TrafficManager();
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
    const tm = new TrafficManager();
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
    const tm = new TrafficManager();
    tm.leave("edge-empty");
    // After leaving an empty edge, factor should still be 1.0 (0 vehicles)
    expect(tm.getCongestionFactor("edge-empty", 0.1)).toBe(1.0);
  });

  it("leave more times than enter should keep occupancy at 0 and factor at 1.0", () => {
    const tm = new TrafficManager();
    tm.enter("edge-1");
    tm.leave("edge-1");
    tm.leave("edge-1");
    tm.leave("edge-1");
    expect(tm.getCongestionFactor("edge-1", 0.1)).toBe(1.0);
  });

  it("enter 5 times then leave 5 times should return factor to 1.0", () => {
    const tm = new TrafficManager();
    for (let i = 0; i < 5; i++) tm.enter("edge-1");
    expect(tm.getCongestionFactor("edge-1", 0.1)).toBeLessThan(1.0);
    for (let i = 0; i < 5; i++) tm.leave("edge-1");
    expect(tm.getCongestionFactor("edge-1", 0.1)).toBe(1.0);
  });
});

describe("TrafficManager - Capacity scaling with distance", () => {
  it("short edge (0.01km, capacity clamped to 1) should congest with 1 vehicle", () => {
    const tm = new TrafficManager();
    tm.enter("short-edge");
    // capacity = max(1, 0.01*20) = max(1, 0.2) = 1, ratio = 1/1 = 1.0
    // factor = 1/(1+1) = 0.5
    const factor = tm.getCongestionFactor("short-edge", 0.01);
    expect(factor).toBeCloseTo(0.5, 5);
  });

  it("long edge (1km, capacity=20) should barely congest with 1 vehicle", () => {
    const tm = new TrafficManager();
    tm.enter("long-edge");
    // capacity = max(1, 1*20) = 20, ratio = 1/20 = 0.05
    // factor = 1/(1+0.0025) = ~0.9975
    const factor = tm.getCongestionFactor("long-edge", 1.0);
    expect(factor).toBeGreaterThan(0.99);
    expect(factor).toBeCloseTo(1 / (1 + 0.0025), 4);
  });

  it("shorter edges should congest faster than longer ones for same vehicle count", () => {
    const tm = new TrafficManager();
    tm.enter("short");
    tm.enter("long");
    const shortFactor = tm.getCongestionFactor("short", 0.01);
    const longFactor = tm.getCongestionFactor("long", 1.0);
    expect(shortFactor).toBeLessThan(longFactor);
  });
});

describe("TrafficManager - Multiple vehicles entering and leaving", () => {
  it("10 vehicles enter then 5 leave: check intermediate factor", () => {
    const tm = new TrafficManager();
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
    const tm = new TrafficManager();
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
    const tm = new TrafficManager();
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
