import { describe, it, expect } from "vitest";
import {
  DEFAULT_HEIGHT_M,
  LEVEL_HEIGHT_M,
  TYPE_DEFAULT_HEIGHT_M,
  parseHeight,
  parseLevels,
  resolveHeight,
} from "./buildingHeight.js";

describe("parseHeight", () => {
  it("reads plain metres, with or without a unit", () => {
    expect(parseHeight("12")).toBe(12);
    expect(parseHeight("12.5 m")).toBe(12.5);
    expect(parseHeight("9m")).toBe(9);
    expect(parseHeight("7,5")).toBe(7.5);
  });

  it("converts feet", () => {
    expect(parseHeight("100 ft")).toBeCloseTo(30.48);
    expect(parseHeight("10'")).toBeCloseTo(3.048);
  });

  it("rejects missing, non-numeric and implausible values", () => {
    expect(parseHeight(undefined)).toBeNull();
    expect(parseHeight("tall")).toBeNull();
    expect(parseHeight("0")).toBeNull();
    expect(parseHeight("-4")).toBeNull();
    expect(parseHeight("3000")).toBeNull();
  });
});

describe("parseLevels", () => {
  it("reads integer and fractional levels", () => {
    expect(parseLevels("4")).toBe(4);
    expect(parseLevels("2.5")).toBe(2.5);
  });

  it("rejects missing, zero and implausible levels", () => {
    expect(parseLevels(undefined)).toBeNull();
    expect(parseLevels("0")).toBeNull();
    expect(parseLevels("many")).toBeNull();
    expect(parseLevels("400")).toBeNull();
  });
});

describe("resolveHeight", () => {
  it("prefers the height tag", () => {
    expect(resolveHeight({ building: "yes", height: "21", "building:levels": "3" })).toBe(21);
  });

  it("falls back to levels x 3 m", () => {
    expect(resolveHeight({ building: "yes", "building:levels": "5" })).toBe(5 * LEVEL_HEIGHT_M);
  });

  it("falls back to levels when height is unusable", () => {
    expect(resolveHeight({ height: "3000", "building:levels": "2" })).toBe(2 * LEVEL_HEIGHT_M);
  });

  it("uses a per-type default for untagged buildings", () => {
    expect(resolveHeight({ building: "apartments" })).toBe(TYPE_DEFAULT_HEIGHT_M.apartments);
    expect(resolveHeight({ building: "garage" })).toBe(TYPE_DEFAULT_HEIGHT_M.garage);
  });

  it("uses the global default for building=yes and unknown types", () => {
    expect(resolveHeight({ building: "yes" })).toBe(DEFAULT_HEIGHT_M);
    expect(resolveHeight({ building: "spaceport" })).toBe(DEFAULT_HEIGHT_M);
    expect(resolveHeight({})).toBe(DEFAULT_HEIGHT_M);
  });

  it("ignores non-string tag values", () => {
    expect(resolveHeight({ building: "yes", height: 12 })).toBe(DEFAULT_HEIGHT_M);
  });

  it("keeps the default within the 6 to 8 m band", () => {
    expect(DEFAULT_HEIGHT_M).toBeGreaterThanOrEqual(6);
    expect(DEFAULT_HEIGHT_M).toBeLessThanOrEqual(8);
  });
});
