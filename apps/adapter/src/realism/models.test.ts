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
