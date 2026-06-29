import { describe, it, expect } from "vitest";
import { getNestedValue, isSafePath, FORBIDDEN_KEYS } from "./utils";

describe("getNestedValue", () => {
  it("returns top-level value", () => {
    expect(getNestedValue({ foo: 42 }, "foo")).toBe(42);
  });

  it("returns nested value", () => {
    expect(getNestedValue({ a: { b: { c: "deep" } } }, "a.b.c")).toBe("deep");
  });

  it("returns undefined for missing path", () => {
    expect(getNestedValue({ a: 1 }, "b")).toBeUndefined();
  });

  it("returns undefined when traversing non-object", () => {
    expect(getNestedValue({ a: "string" }, "a.b")).toBeUndefined();
  });

  it("returns falsy own values (0, false, '') rather than skipping them", () => {
    expect(getNestedValue({ a: { b: 0 } }, "a.b")).toBe(0);
    expect(getNestedValue({ a: { b: false } }, "a.b")).toBe(false);
    expect(getNestedValue({ a: { b: "" } }, "a.b")).toBe("");
  });

  describe("prototype-pollution guard (consolidated resolver)", () => {
    it("returns undefined for a __proto__ segment", () => {
      expect(getNestedValue({ a: 1 }, "__proto__.polluted")).toBeUndefined();
    });

    it("returns undefined for a constructor segment", () => {
      expect(getNestedValue({ a: 1 }, "constructor.prototype.polluted")).toBeUndefined();
    });

    it("returns undefined for a prototype segment anywhere in the path", () => {
      expect(getNestedValue({ a: { prototype: { x: 1 } } }, "a.prototype.x")).toBeUndefined();
    });

    it("never dereferences a forbidden key even when present as an own key", () => {
      const obj = JSON.parse('{"__proto__": {"x": 1}}');
      expect(getNestedValue(obj, "__proto__.x")).toBeUndefined();
    });
  });
});

describe("isSafePath", () => {
  it("accepts ordinary dot-paths", () => {
    expect(isSafePath("a.b.c")).toBe(true);
    expect(isSafePath("metadata.deviceType")).toBe(true);
  });

  it("rejects paths containing any forbidden key", () => {
    for (const key of FORBIDDEN_KEYS) {
      expect(isSafePath(`a.${key}.b`)).toBe(false);
    }
  });
});
