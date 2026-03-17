import { describe, it, expect } from "vitest";
import { isRoad, isPOI } from "./typeGuards";

describe("isRoad", () => {
  it("returns true for objects with streets property", () => {
    expect(isRoad({ name: "Test Road", streets: [[1, 2]] } as any)).toBe(true);
  });

  it("returns false for POI objects", () => {
    expect(isRoad({ name: "Test POI", type: "shop", coordinates: [1, 2] } as any)).toBe(false);
  });
});

describe("isPOI", () => {
  it("returns true for objects with type property", () => {
    expect(isPOI({ name: "Test POI", type: "shop", coordinates: [1, 2] } as any)).toBe(true);
  });

  it("returns false for Road objects without type", () => {
    expect(isPOI({ name: "Test Road", streets: [[1, 2]] } as any)).toBe(false);
  });
});
