import { describe, it, expect } from "vitest";
import { createPOI } from "@/test/mocks/types";
import { isBusStop, isNotBusStop, getFillByType } from "./helpers";

describe("isBusStop", () => {
  it("returns true for bus_stop type", () => {
    const poi = createPOI({ type: "bus_stop" });
    expect(isBusStop(poi)).toBe(true);
  });

  it("returns false for non-bus_stop types", () => {
    expect(isBusStop(createPOI({ type: "shop" }))).toBe(false);
    expect(isBusStop(createPOI({ type: "leisure" }))).toBe(false);
    expect(isBusStop(createPOI({ type: "office" }))).toBe(false);
  });
});

describe("isNotBusStop", () => {
  it("returns false for bus_stop type", () => {
    const poi = createPOI({ type: "bus_stop" });
    expect(isNotBusStop(poi)).toBe(false);
  });

  it("returns true for non-bus_stop types", () => {
    expect(isNotBusStop(createPOI({ type: "shop" }))).toBe(true);
    expect(isNotBusStop(createPOI({ type: "leisure" }))).toBe(true);
    expect(isNotBusStop(createPOI({ type: "office" }))).toBe(true);
  });

  it("is the inverse of isBusStop", () => {
    const busStop = createPOI({ type: "bus_stop" });
    const shop = createPOI({ type: "shop" });
    expect(isNotBusStop(busStop)).toBe(!isBusStop(busStop));
    expect(isNotBusStop(shop)).toBe(!isBusStop(shop));
  });
});

describe("getFillByType", () => {
  it("returns shop color for 'shop'", () => {
    expect(getFillByType("shop")).toBe("var(--color-poi-shop)");
  });

  it("returns leisure color for 'leisure'", () => {
    expect(getFillByType("leisure")).toBe("var(--color-poi-leisure)");
  });

  it("returns craft color for 'craft'", () => {
    expect(getFillByType("craft")).toBe("var(--color-poi-craft)");
  });

  it("returns office color for 'office'", () => {
    expect(getFillByType("office")).toBe("var(--color-poi-office)");
  });

  it("returns bus color for 'bus_stop'", () => {
    expect(getFillByType("bus_stop")).toBe("var(--color-poi-bus)");
  });

  it("returns default color for unknown type", () => {
    expect(getFillByType("unknown")).toBe("var(--color-poi-default)");
    expect(getFillByType("")).toBe("var(--color-poi-default)");
  });
});
