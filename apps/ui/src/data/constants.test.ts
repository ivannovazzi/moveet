import { describe, it, expect } from "vitest";
import {
  DEFAULT_START_OPTIONS,
  VEHICLE_RENDER,
  VEHICLE_INTERPOLATION,
  HEAT_LAYER,
} from "./constants";

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

  describe("VEHICLE_RENDER", () => {
    it("should define selection ring radius as a positive number", () => {
      expect(VEHICLE_RENDER.SELECTION_RING_RADIUS).toBe(6);
      expect(VEHICLE_RENDER.SELECTION_RING_RADIUS).toBeGreaterThan(0);
    });

    it("should define hit test radius larger than selection ring (for comfortable clicking)", () => {
      expect(VEHICLE_RENDER.HIT_TEST_RADIUS).toBe(8);
      expect(VEHICLE_RENDER.HIT_TEST_RADIUS).toBeGreaterThan(VEHICLE_RENDER.SELECTION_RING_RADIUS);
    });

    it("should define stroke widths as positive values less than 1", () => {
      expect(VEHICLE_RENDER.STROKE_WIDTH).toBe(0.5);
      expect(VEHICLE_RENDER.GLOW_STROKE_WIDTH).toBe(0.8);
      expect(VEHICLE_RENDER.SELECTION_RING_STROKE_WIDTH).toBe(0.4);
      expect(VEHICLE_RENDER.STROKE_WIDTH).toBeGreaterThan(0);
      expect(VEHICLE_RENDER.GLOW_STROKE_WIDTH).toBeGreaterThan(0);
      expect(VEHICLE_RENDER.SELECTION_RING_STROKE_WIDTH).toBeGreaterThan(0);
    });

    it("should define glow radii as positive integers", () => {
      expect(VEHICLE_RENDER.HOVER_GLOW_RADIUS).toBe(3);
      expect(VEHICLE_RENDER.SELECTED_GLOW_RADIUS).toBe(4);
      expect(VEHICLE_RENDER.SELECTED_GLOW_RADIUS).toBeGreaterThan(VEHICLE_RENDER.HOVER_GLOW_RADIUS);
    });
  });

  describe("VEHICLE_INTERPOLATION", () => {
    it("should define DEFAULT_LERP_MS as a positive millisecond value", () => {
      expect(VEHICLE_INTERPOLATION.DEFAULT_LERP_MS).toBe(150);
      expect(VEHICLE_INTERPOLATION.DEFAULT_LERP_MS).toBeGreaterThan(0);
    });

    it("should define MIN_LERP_MS less than DEFAULT_LERP_MS", () => {
      expect(VEHICLE_INTERPOLATION.MIN_LERP_MS).toBe(30);
      expect(VEHICLE_INTERPOLATION.MIN_LERP_MS).toBeLessThan(VEHICLE_INTERPOLATION.DEFAULT_LERP_MS);
    });

    it("should define MAX_T slightly above 1 for extrapolation", () => {
      expect(VEHICLE_INTERPOLATION.MAX_T).toBe(1.15);
      expect(VEHICLE_INTERPOLATION.MAX_T).toBeGreaterThan(1);
      expect(VEHICLE_INTERPOLATION.MAX_T).toBeLessThan(2);
    });
  });

  describe("HEAT_LAYER", () => {
    it("should define viewport dimensions as positive integers", () => {
      expect(HEAT_LAYER.VIEWPORT_WIDTH).toBe(1300);
      expect(HEAT_LAYER.VIEWPORT_HEIGHT).toBe(1000);
      expect(Number.isInteger(HEAT_LAYER.VIEWPORT_WIDTH)).toBe(true);
      expect(Number.isInteger(HEAT_LAYER.VIEWPORT_HEIGHT)).toBe(true);
    });

    it("should have a landscape viewport (width > height)", () => {
      expect(HEAT_LAYER.VIEWPORT_WIDTH).toBeGreaterThan(HEAT_LAYER.VIEWPORT_HEIGHT);
    });
  });
});
