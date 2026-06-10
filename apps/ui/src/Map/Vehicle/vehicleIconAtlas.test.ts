import { describe, it, expect } from "vitest";
import { parseColor, shade, VehicleIconAtlasManager } from "./vehicleIconAtlas";

describe("parseColor", () => {
  it("parses 6-digit hex", () => {
    expect(parseColor("#f59e0b")).toEqual([245, 158, 11]);
  });

  it("parses 3-digit hex", () => {
    expect(parseColor("#fff")).toEqual([255, 255, 255]);
  });

  it("parses rgb() strings", () => {
    expect(parseColor("rgb(10, 20, 30)")).toEqual([10, 20, 30]);
  });

  it("parses rgba() strings, ignoring alpha", () => {
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual([10, 20, 30]);
  });

  it("falls back to light gray for unparseable input", () => {
    expect(parseColor("not-a-color")).toEqual([220, 220, 220]);
  });
});

describe("shade", () => {
  it("returns the same color at amt 0", () => {
    expect(shade("#102030", 0)).toBe("rgb(16, 32, 48)");
  });

  it("mixes toward white for positive amounts", () => {
    expect(shade("#000000", 1)).toBe("rgb(255, 255, 255)");
    expect(shade("#000000", 0.5)).toBe("rgb(128, 128, 128)");
  });

  it("mixes toward black for negative amounts", () => {
    expect(shade("#ffffff", -1)).toBe("rgb(0, 0, 0)");
  });
});

describe("VehicleIconAtlasManager", () => {
  it("registers a combo and reports dirty", () => {
    const m = new VehicleIconAtlasManager();
    expect(m.isDirty).toBe(false);
    const key = m.register("car", "#dcdcdc");
    expect(key).toBe("car|#dcdcdc");
    expect(m.isDirty).toBe(true);
  });

  it("dedupes repeated registrations", () => {
    const m = new VehicleIconAtlasManager();
    m.register("car", "#dcdcdc");
    m.build();
    expect(m.isDirty).toBe(false);
    m.register("car", "#dcdcdc");
    expect(m.isDirty).toBe(false);
  });

  it("becomes dirty again when a new combo appears", () => {
    const m = new VehicleIconAtlasManager();
    m.register("car", "#dcdcdc");
    m.build();
    m.register("car", "#ff0000");
    expect(m.isDirty).toBe(true);
  });

  it("falls back to the car sprite for unknown types", () => {
    const m = new VehicleIconAtlasManager();
    expect(m.register("hovercraft", "#dcdcdc")).toBe("car|#dcdcdc");
  });

  it("builds a mapping with one cell per combo, wrapping rows past 8 columns", () => {
    const m = new VehicleIconAtlasManager();
    const colors = ["#1", "#2", "#3", "#4", "#5", "#6", "#7", "#8", "#9"].map(
      (c) => c + "00000".slice(0, 6 - c.length + 1)
    );
    for (const c of colors) m.register("car", c);
    const { iconMapping } = m.build();
    const entries = Object.values(iconMapping);
    expect(entries).toHaveLength(9);
    // 9th cell wraps to the second row
    expect(entries[8].y).toBeGreaterThan(0);
    expect(entries[8].x).toBe(0);
    expect(m.isDirty).toBe(false);
  });
});
