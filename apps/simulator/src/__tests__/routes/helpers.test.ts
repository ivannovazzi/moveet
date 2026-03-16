import { describe, it, expect } from "vitest";
import { validateCoordinates, validateSearchQuery } from "../../routes/helpers";

describe("Route helpers", () => {
  describe("validateCoordinates", () => {
    it("should accept valid [number, number] arrays", () => {
      expect(validateCoordinates([1.5, 2.5])).toBe(true);
      expect(validateCoordinates([0, 0])).toBe(true);
      expect(validateCoordinates([-73.5, 45.5])).toBe(true);
    });

    it("should reject non-array values", () => {
      expect(validateCoordinates(null)).toBe(false);
      expect(validateCoordinates(undefined)).toBe(false);
      expect(validateCoordinates("hello")).toBe(false);
      expect(validateCoordinates(42)).toBe(false);
      expect(validateCoordinates({})).toBe(false);
    });

    it("should reject arrays with wrong length", () => {
      expect(validateCoordinates([])).toBe(false);
      expect(validateCoordinates([1])).toBe(false);
      expect(validateCoordinates([1, 2, 3])).toBe(false);
    });

    it("should reject arrays with non-number elements", () => {
      expect(validateCoordinates(["a", "b"])).toBe(false);
      expect(validateCoordinates([1, "b"])).toBe(false);
      expect(validateCoordinates([null, 2])).toBe(false);
    });

    it("should reject arrays with NaN", () => {
      expect(validateCoordinates([NaN, 1])).toBe(false);
      expect(validateCoordinates([1, NaN])).toBe(false);
    });
  });

  describe("validateSearchQuery", () => {
    it("should accept valid search queries", () => {
      expect(validateSearchQuery({ query: "Main Street" })).toBe(true);
      expect(validateSearchQuery({ query: "a" })).toBe(true);
    });

    it("should reject missing or empty query", () => {
      expect(validateSearchQuery({})).toBe(false);
      expect(validateSearchQuery({ query: "" })).toBe(false);
      expect(validateSearchQuery(null)).toBe(false);
      expect(validateSearchQuery(undefined)).toBe(false);
    });

    it("should reject non-string query values", () => {
      expect(validateSearchQuery({ query: 42 })).toBe(false);
      expect(validateSearchQuery({ query: null })).toBe(false);
      expect(validateSearchQuery({ query: true })).toBe(false);
    });

    it("should reject non-object inputs", () => {
      expect(validateSearchQuery("string")).toBe(false);
      expect(validateSearchQuery(42)).toBe(false);
      expect(validateSearchQuery([])).toBe(false);
    });
  });
});
