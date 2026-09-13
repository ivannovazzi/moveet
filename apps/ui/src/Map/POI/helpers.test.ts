import { describe, it, expect } from "vitest";
import { POI_GROUPS } from "./categories";
import { getFillForGroup } from "./helpers";

describe("getFillForGroup", () => {
  it("returns the group's token", () => {
    expect(getFillForGroup("shop")).toBe("var(--color-poi-shop)");
    expect(getFillForGroup("health")).toBe("var(--color-poi-health)");
    expect(getFillForGroup("transit")).toBe("var(--color-poi-transit)");
  });

  it("has a distinct token for every group", () => {
    const tokens = POI_GROUPS.map(getFillForGroup);
    expect(new Set(tokens).size).toBe(POI_GROUPS.length);
  });
});
