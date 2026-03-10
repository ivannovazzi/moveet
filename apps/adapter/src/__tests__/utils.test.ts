import { describe, it, expect } from "vitest";
import { getNestedValue } from "../plugins/utils";

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

  it("returns undefined for deep missing path", () => {
    expect(getNestedValue({ a: { b: 1 } }, "a.x.y")).toBeUndefined();
  });

  it("handles null input", () => {
    expect(getNestedValue(null, "a")).toBeUndefined();
  });

  it("handles array access", () => {
    expect(getNestedValue({ items: [10, 20, 30] }, "items.1")).toBe(20);
  });
});
