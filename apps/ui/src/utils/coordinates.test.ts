import { describe, it, expect } from "vitest";
import { calculateRotation, invertLatLng } from "./coordinates";

describe("calculateRotation", () => {
  it("returns 0 for same angle", () => {
    expect(calculateRotation(90, 90)).toBe(0);
  });

  it("returns positive diff for clockwise rotation", () => {
    expect(calculateRotation(0, 90)).toBe(90);
  });

  it("returns negative diff for counter-clockwise rotation", () => {
    expect(calculateRotation(90, 0)).toBe(-90);
  });

  it("takes shortest path across 360 boundary", () => {
    expect(calculateRotation(350, 10)).toBe(20);
  });

  it("takes shortest path counter-clockwise across boundary", () => {
    expect(calculateRotation(10, 350)).toBe(-20);
  });

  it("normalizes angles beyond 360", () => {
    expect(calculateRotation(370, 380)).toBe(10);
  });

  it("handles negative input angles", () => {
    expect(calculateRotation(-10, 10)).toBe(20);
  });

  it("returns 180 for opposite directions", () => {
    const result = calculateRotation(0, 180);
    expect(Math.abs(result)).toBe(180);
  });
});

describe("invertLatLng", () => {
  it("swaps [a, b] to [b, a]", () => {
    expect(invertLatLng([1.5, 2.5])).toEqual([2.5, 1.5]);
  });

  it("handles negative coordinates", () => {
    expect(invertLatLng([-36.8, 174.7])).toEqual([174.7, -36.8]);
  });

  it("handles zero values", () => {
    expect(invertLatLng([0, 0])).toEqual([0, 0]);
  });
});
