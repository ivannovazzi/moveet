import { describe, it, expect } from "vitest";
import { metersToLatLon, METERS_PER_DEG_LAT } from "./models";

describe("metersToLatLon", () => {
  it("converts north offset using fixed meters-per-degree", () => {
    const { dLat } = metersToLatLon(0, METERS_PER_DEG_LAT, 0);
    expect(dLat).toBeCloseTo(1, 6); // 111320 m north == 1 degree lat
  });

  it("scales longitude by cos(latitude)", () => {
    // At Nairobi (~ -1.3 deg) cos is ~0.99974
    const lat = -1.2921;
    const { dLon } = metersToLatLon(METERS_PER_DEG_LAT, 0, lat);
    const expected = 1 / Math.cos((lat * Math.PI) / 180);
    expect(dLon).toBeCloseTo(expected, 4);
  });

  it("at the equator 1 deg lon == METERS_PER_DEG_LAT east", () => {
    const { dLon } = metersToLatLon(METERS_PER_DEG_LAT, 0, 0);
    expect(dLon).toBeCloseTo(1, 6);
  });
});

import { gaussMarkovStep } from "./models";
import { mulberry32, makeGaussian } from "./rng";

describe("gaussMarkovStep", () => {
  it("with tau -> 0 approaches white noise (no memory)", () => {
    const g = makeGaussian(mulberry32(3));
    // very small tau relative to dt => alpha ~ 0 => next ~ sigma * gaussian
    const next = gaussMarkovStep(100, 4, 0.0001, 1, g);
    // previous value 100 should be almost entirely forgotten
    expect(Math.abs(next)).toBeLessThan(4 * 6); // within ~6 sigma, not near 100
  });

  it("with tau -> infinity behaves like a random walk (keeps prior)", () => {
    const g = makeGaussian(mulberry32(3));
    const prev = 50;
    const next = gaussMarkovStep(prev, 4, 1e9, 1, g);
    // alpha ~ 1, added noise ~ 0 => next ~ prev
    expect(next).toBeCloseTo(prev, 2);
  });

  it("reaches steady-state variance ~ sigma^2", () => {
    const g = makeGaussian(mulberry32(11));
    const sigma = 4;
    const tau = 30;
    const dt = 1;
    let x = 0;
    const samples: number[] = [];
    for (let i = 0; i < 200000; i++) {
      x = gaussMarkovStep(x, sigma, tau, dt, g);
      if (i > 1000) samples.push(x);
    }
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / samples.length;
    expect(Math.abs(mean)).toBeLessThan(0.3);
    expect(variance).toBeGreaterThan(sigma * sigma * 0.85);
    expect(variance).toBeLessThan(sigma * sigma * 1.15);
  });
});
