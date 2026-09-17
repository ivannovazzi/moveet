import { describe, expect, it } from "vitest";
import {
  degreesPerPixel,
  graticuleLod,
  graticulePaths,
  GRATICULE_STEPS,
  snapBounds,
  type GeoBounds,
  type GraticulePath,
} from "../graticule";

describe("degreesPerPixel", () => {
  it("halves with every zoom level", () => {
    expect(degreesPerPixel(11) / degreesPerPixel(12)).toBeCloseTo(2, 10);
  });

  it("spans the world across deck.gl's 512px tile at zoom 0", () => {
    expect(degreesPerPixel(0) * 512).toBeCloseTo(360, 10);
  });
});

describe("graticuleLod", () => {
  it("only ever picks a step off the ladder", () => {
    for (let zoom = 1; zoom <= 22; zoom += 0.25) {
      expect(GRATICULE_STEPS).toContain(graticuleLod(zoom).coarse);
    }
  });

  it("keeps on-screen spacing inside a factor of two of the target", () => {
    for (let zoom = 4; zoom <= 20; zoom += 0.25) {
      const spacingPx = graticuleLod(zoom).coarse / degreesPerPixel(zoom);
      expect(spacingPx).toBeGreaterThan(70);
      expect(spacingPx).toBeLessThan(260);
    }
  });

  it("gets finer as you zoom in, never coarser", () => {
    let previous = Infinity;
    for (let zoom = 4; zoom <= 20; zoom += 0.25) {
      const { coarse } = graticuleLod(zoom);
      expect(coarse).toBeLessThanOrEqual(previous);
      previous = coarse;
    }
  });

  it("draws the half-step tier between the solid lines", () => {
    expect(graticuleLod(14).fine).toBeCloseTo(graticuleLod(14).coarse / 2, 12);
  });

  it("fades the half-step tier in rather than switching it on", () => {
    // Walk a whole rung and collect the fades seen while it is the live step.
    const fades: number[] = [];
    for (let zoom = 4; zoom <= 20; zoom += 0.05) {
      fades.push(graticuleLod(zoom).fineFade);
    }
    expect(Math.min(...fades)).toBe(0);
    expect(Math.max(...fades)).toBe(1);
    // Every intermediate value is reachable: the ramp is continuous, so some
    // sample lands strictly between the ends.
    expect(fades.some((f) => f > 0 && f < 1)).toBe(true);
  });

  it("falls back to a usable step for a non-finite zoom", () => {
    expect(GRATICULE_STEPS).toContain(graticuleLod(Number.NaN).coarse);
  });
});

describe("snapBounds", () => {
  const bounds: GeoBounds = [
    [36.7123, -1.3456],
    [36.9321, -1.1234],
  ];

  it("grows the box outward to whole blocks", () => {
    const [[west, south], [east, north]] = snapBounds(bounds, 0.01, 8);
    expect(west).toBeLessThanOrEqual(36.7123);
    expect(south).toBeLessThanOrEqual(-1.3456);
    expect(east).toBeGreaterThanOrEqual(36.9321);
    expect(north).toBeGreaterThanOrEqual(-1.1234);
  });

  it("lands on multiples of step x cells, so panning re-snaps rarely", () => {
    const block = 0.01 * 8;
    const [[west, south]] = snapBounds(bounds, 0.01, 8);
    expect(west / block).toBeCloseTo(Math.round(west / block), 6);
    expect(south / block).toBeCloseTo(Math.round(south / block), 6);
  });

  it("returns the same box for two nearby viewports", () => {
    const nudged: GeoBounds = [
      [36.7133, -1.3446],
      [36.9331, -1.1224],
    ];
    expect(snapBounds(nudged, 0.01, 8)).toEqual(snapBounds(bounds, 0.01, 8));
  });
});

/** The one coordinate a grid line is defined by: its lng, or its lat. */
function lineCoordinate([[x1, y1], [x2]]: GraticulePath): number {
  return x1 === x2 ? x1 : y1;
}

describe("graticulePaths", () => {
  const bounds: GeoBounds = [
    [36.0, -1.4],
    [36.4, -1.0],
  ];

  it("emits a meridian and a parallel for every multiple in range", () => {
    const paths = graticulePaths(bounds, 0.1);
    // 36.0..36.4 and -1.4..-1.0 inclusive: five lines on each axis.
    expect(paths).toHaveLength(10);
  });

  it("draws meridians full height and parallels full width", () => {
    const paths = graticulePaths(bounds, 0.2);
    for (const [[x1, y1], [x2, y2]] of paths) {
      const vertical = x1 === x2;
      expect(vertical || y1 === y2).toBe(true);
      if (vertical) {
        expect([y1, y2]).toEqual([-1.4, -1.0]);
      } else {
        expect([x1, x2]).toEqual([36.0, 36.4]);
      }
    }
  });

  it("skips the lines the coarse tier already draws", () => {
    const fine = graticulePaths(bounds, 0.05, 0.1);
    // Ten lines at 0.05 across each axis, minus the five the coarse tier owns.
    expect(fine).toHaveLength(8);
    for (const value of fine.map(lineCoordinate)) {
      expect(Math.abs(value / 0.1 - Math.round(value / 0.1))).toBeGreaterThan(1e-6);
    }
  });

  it("stays on round coordinates instead of accumulating float drift", () => {
    const meridians = graticulePaths(
      [
        [0, 0],
        [0.02, 0],
      ],
      0.0002
    ).filter(([[x1], [x2]]) => x1 === x2);
    expect(meridians).toHaveLength(101);
    expect(lineCoordinate(meridians[meridians.length - 1])).toBeCloseTo(0.02, 12);
  });

  it("returns nothing for a non-positive step", () => {
    expect(graticulePaths(bounds, 0)).toEqual([]);
    expect(graticulePaths(bounds, -1)).toEqual([]);
  });

  it("bails rather than building tens of thousands of paths", () => {
    expect(
      graticulePaths(
        [
          [-180, -85],
          [180, 85],
        ],
        0.001
      )
    ).toEqual([]);
  });
});
