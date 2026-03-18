import { describe, it, expect } from "vitest";
import { resolveRegion, listRegions } from "./regions.js";

describe("resolveRegion", () => {
  it("resolves a known region by name", () => {
    const r = resolveRegion({ region: "nairobi" });
    expect(r.bbox).toEqual([36.65, -1.45, 37.10, -1.15]);
    expect(r.geofabrik).toBe("africa/kenya");
    expect(r.label).toBe("Nairobi, Kenya");
  });

  it("resolves a custom region via bbox + geofabrik flags", () => {
    const r = resolveRegion({
      bbox: [36.65, -1.45, 37.10, -1.15],
      geofabrik: "africa/kenya",
    });
    expect(r.bbox).toEqual([36.65, -1.45, 37.10, -1.15]);
    expect(r.geofabrik).toBe("africa/kenya");
    expect(r.label).toBe("Custom region");
  });

  it("throws on unknown region without bbox fallback", () => {
    expect(() => resolveRegion({ region: "atlantis" })).toThrow(
      /unknown region: atlantis/i
    );
  });

  it("bbox must have exactly 4 numbers [W, S, E, N]", () => {
    expect(() =>
      resolveRegion({ bbox: [1, 2, 3] as unknown as [number, number, number, number], geofabrik: "x/y" })
    ).toThrow();
  });
});

describe("listRegions", () => {
  it("returns all region names sorted", () => {
    const names = listRegions();
    expect(names).toContain("nairobi");
    expect(names).toContain("london");
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(names).toEqual([...names].sort());
  });
});
