import { describe, it, expect } from "vitest";
import {
  distributeByWeight,
  DEFAULT_VEHICLE_TYPE_WEIGHTS,
  VEHICLE_PROFILES,
  getProfile,
} from "../utils/vehicleProfiles";
import type { VehicleType } from "../types";

const ALL_TYPES: VehicleType[] = ["car", "truck", "motorcycle", "ambulance", "bus"];

describe("distributeByWeight", () => {
  it("returns exact total count", () => {
    for (const total of [1, 3, 5, 10, 50, 70, 100, 200]) {
      const dist = distributeByWeight(total);
      const sum = Object.values(dist).reduce((a, b) => a + b, 0);
      expect(sum).toBe(total);
    }
  });

  it("uses all vehicle types for a large enough count", () => {
    const dist = distributeByWeight(100);
    for (const type of ALL_TYPES) {
      expect(dist[type]).toBeGreaterThan(0);
    }
  });

  it("car is the most common type (largest weight)", () => {
    const dist = distributeByWeight(100);
    for (const type of ALL_TYPES) {
      if (type !== "car") {
        expect(dist.car).toBeGreaterThan(dist[type]!);
      }
    }
  });

  it("ambulance is the rarest type", () => {
    const dist = distributeByWeight(100);
    for (const type of ALL_TYPES) {
      if (type !== "ambulance") {
        expect(dist[type]!).toBeGreaterThanOrEqual(dist.ambulance!);
      }
    }
  });

  it("produces multiple types for moderate counts", () => {
    const dist = distributeByWeight(10);
    const typesPresent = Object.keys(dist).length;
    expect(typesPresent).toBeGreaterThanOrEqual(2);
  });

  it("handles count of 1 without error", () => {
    const dist = distributeByWeight(1);
    const sum = Object.values(dist).reduce((a, b) => a + b, 0);
    expect(sum).toBe(1);
  });

  it("accepts custom weights", () => {
    const dist = distributeByWeight(10, {
      car: 50,
      truck: 50,
      motorcycle: 0,
      ambulance: 0,
      bus: 0,
    });
    const sum = Object.values(dist).reduce((a, b) => a + b, 0);
    expect(sum).toBe(10);
    // Only car and truck should be present
    expect((dist.car ?? 0) + (dist.truck ?? 0)).toBe(10);
  });
});

describe("DEFAULT_VEHICLE_TYPE_WEIGHTS", () => {
  it("weights sum to 100", () => {
    const sum = Object.values(DEFAULT_VEHICLE_TYPE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it("has an entry for every VehicleType", () => {
    for (const type of ALL_TYPES) {
      expect(DEFAULT_VEHICLE_TYPE_WEIGHTS[type]).toBeDefined();
      expect(DEFAULT_VEHICLE_TYPE_WEIGHTS[type]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("VEHICLE_PROFILES", () => {
  it("has a profile for every vehicle type", () => {
    for (const type of ALL_TYPES) {
      expect(VEHICLE_PROFILES[type]).toBeDefined();
    }
  });
});

describe("getProfile", () => {
  it("returns the correct profile for each type", () => {
    for (const type of ALL_TYPES) {
      const profile = getProfile(type);
      expect(profile.type).toBe(type);
    }
  });
});
