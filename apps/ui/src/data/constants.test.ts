import { describe, it, expect } from "vitest";
import { DEFAULT_START_OPTIONS } from "./constants";

describe("constants", () => {
  describe("DEFAULT_START_OPTIONS", () => {
    it("should have all required properties", () => {
      expect(DEFAULT_START_OPTIONS).toHaveProperty("minSpeed");
      expect(DEFAULT_START_OPTIONS).toHaveProperty("maxSpeed");
      expect(DEFAULT_START_OPTIONS).toHaveProperty("acceleration");
      expect(DEFAULT_START_OPTIONS).toHaveProperty("deceleration");
      expect(DEFAULT_START_OPTIONS).toHaveProperty("turnThreshold");
      expect(DEFAULT_START_OPTIONS).toHaveProperty("updateInterval");
      expect(DEFAULT_START_OPTIONS).toHaveProperty("speedVariation");
      expect(DEFAULT_START_OPTIONS).toHaveProperty("heatZoneSpeedFactor");
    });

    it("should have valid number values", () => {
      expect(DEFAULT_START_OPTIONS.minSpeed).toBeGreaterThan(0);
      expect(DEFAULT_START_OPTIONS.maxSpeed).toBeGreaterThan(DEFAULT_START_OPTIONS.minSpeed);
      expect(DEFAULT_START_OPTIONS.acceleration).toBeGreaterThan(0);
      expect(DEFAULT_START_OPTIONS.deceleration).toBeGreaterThan(0);
      expect(DEFAULT_START_OPTIONS.updateInterval).toBeGreaterThan(0);
    });

    it("should have reasonable default values", () => {
      expect(DEFAULT_START_OPTIONS.speedVariation).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_START_OPTIONS.speedVariation).toBeLessThanOrEqual(1);
      expect(DEFAULT_START_OPTIONS.heatZoneSpeedFactor).toBeGreaterThan(0);
      expect(DEFAULT_START_OPTIONS.heatZoneSpeedFactor).toBeLessThanOrEqual(1);
    });
  });
});
