import { describe, it, expect, vi } from "vitest";
import { eValue } from "./form";

describe("eValue", () => {
  it("extracts checkbox checked value", () => {
    const fn = vi.fn();
    const handler = eValue(fn);
    handler({
      target: { type: "checkbox", checked: true, value: "" },
    } as any);
    expect(fn).toHaveBeenCalledWith(true);
  });

  it("extracts input text value", () => {
    const fn = vi.fn();
    const handler = eValue(fn);
    handler({
      target: { type: "text", checked: false, value: "hello" },
    } as any);
    expect(fn).toHaveBeenCalledWith("hello");
  });

  it("extracts number input value as string", () => {
    const fn = vi.fn();
    const handler = eValue(fn);
    handler({
      target: { type: "number", checked: false, value: "42" },
    } as any);
    expect(fn).toHaveBeenCalledWith("42");
  });
});
