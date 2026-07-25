import { describe, it, expect, beforeEach } from "vitest";
import {
  DENSITY_MIN_VEHICLES,
  DENSITY_ZOOM_THRESHOLD,
  densityColorRange,
  hexRadiusMetersForZoom,
  resetDensityColorRange,
  shouldAggregate,
} from "./densityView";

describe("shouldAggregate", () => {
  const busy = { enabled: true, vehicleCount: DENSITY_MIN_VEHICLES + 500 };

  it("never aggregates while the Density toggle is off", () => {
    expect(shouldAggregate({ ...busy, enabled: false, zoom: 5 })).toBe(false);
  });

  // ── zoom boundary ────────────────────────────────────────────────
  it("aggregates just below the zoom threshold", () => {
    expect(shouldAggregate({ ...busy, zoom: DENSITY_ZOOM_THRESHOLD - 0.01 })).toBe(true);
  });

  it("does NOT aggregate exactly at the zoom threshold", () => {
    expect(shouldAggregate({ ...busy, zoom: DENSITY_ZOOM_THRESHOLD })).toBe(false);
  });

  it("does not aggregate above the zoom threshold", () => {
    expect(shouldAggregate({ ...busy, zoom: DENSITY_ZOOM_THRESHOLD + 3 })).toBe(false);
  });

  // ── count boundary ───────────────────────────────────────────────
  const zoomedOut = { enabled: true, zoom: DENSITY_ZOOM_THRESHOLD - 2 };

  it("aggregates exactly at the minimum vehicle count", () => {
    expect(shouldAggregate({ ...zoomedOut, vehicleCount: DENSITY_MIN_VEHICLES })).toBe(true);
  });

  it("does NOT aggregate one vehicle below the minimum count", () => {
    expect(shouldAggregate({ ...zoomedOut, vehicleCount: DENSITY_MIN_VEHICLES - 1 })).toBe(false);
  });

  it("is inert for a non-finite zoom", () => {
    expect(shouldAggregate({ ...busy, zoom: Number.NaN })).toBe(false);
  });
});

describe("hexRadiusMetersForZoom", () => {
  it("halves the bin radius for each zoom level in", () => {
    const wide = hexRadiusMetersForZoom(10);
    const close = hexRadiusMetersForZoom(11);
    expect(close / wide).toBeCloseTo(0.5, 2);
  });

  it("buckets to half-zoom steps so small zoom deltas don't re-bin", () => {
    expect(hexRadiusMetersForZoom(11.1)).toBe(hexRadiusMetersForZoom(11.2));
    expect(hexRadiusMetersForZoom(11.1)).toBe(hexRadiusMetersForZoom(11));
    // …but a half-step apart is a different radius.
    expect(hexRadiusMetersForZoom(11.5)).not.toBe(hexRadiusMetersForZoom(11));
  });

  it("clamps to a sane range", () => {
    expect(hexRadiusMetersForZoom(0)).toBeLessThanOrEqual(20000);
    expect(hexRadiusMetersForZoom(24)).toBeGreaterThanOrEqual(100);
  });
});

describe("densityColorRange", () => {
  beforeEach(() => resetDensityColorRange());

  it("is a 6-step RGBA ramp", () => {
    const ramp = densityColorRange();
    expect(ramp).toHaveLength(6);
    for (const step of ramp) {
      expect(step).toHaveLength(4);
      for (const channel of step) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });

  it("is sequential — alpha and luminance rise monotonically", () => {
    const ramp = densityColorRange();
    for (let i = 1; i < ramp.length; i++) {
      expect(ramp[i][3]).toBeGreaterThan(ramp[i - 1][3]);
      const prev = ramp[i - 1][0] + ramp[i - 1][1] + ramp[i - 1][2];
      const curr = ramp[i][0] + ramp[i][1] + ramp[i][2];
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  it("is single-hue — no rainbow ramp", () => {
    const ramp = densityColorRange();
    // Every step is a scalar multiple of the same base colour, so the
    // channel ratios are constant across the ramp.
    const ratio = (c: number[]) => (c[0] + 1) / (c[2] + 1);
    const first = ratio(ramp[0]);
    for (const step of ramp) {
      expect(ratio(step)).toBeCloseTo(first, 1);
    }
  });

  it("memoizes the resolved ramp", () => {
    expect(densityColorRange()).toBe(densityColorRange());
  });
});
