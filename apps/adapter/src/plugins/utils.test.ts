import { describe, it, expect } from "vitest";
import { getNestedValue } from "./utils";

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
});
