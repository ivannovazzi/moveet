import { describe, expect, it } from "vitest";
import {
  buildSeries,
  downsample,
  extent,
  formatTimeTick,
  nearestIndexForFraction,
  niceTicks,
  plotBox,
  round2,
} from "./geometry";

describe("round2", () => {
  it("rounds to two decimals", () => {
    expect(round2(1.2345)).toBe(1.23);
    expect(round2(1.2355)).toBe(1.24);
    expect(round2(1.0049)).toBe(1);
    expect(round2(-2.3449)).toBe(-2.34);
  });
});

describe("plotBox", () => {
  it("insets the drawable rectangle", () => {
    expect(plotBox(100, 50, { top: 2, right: 4, bottom: 6, left: 8 })).toEqual({
      x0: 8,
      x1: 96,
      y0: 2,
      y1: 44,
    });
  });
});

describe("extent", () => {
  it("returns min and max of the finite values", () => {
    expect(extent([3, 1, 2])).toEqual([1, 3]);
  });

  it("skips non-finite values", () => {
    expect(extent([Number.NaN, 5, Number.POSITIVE_INFINITY, 2])).toEqual([2, 5]);
  });

  it("returns null when nothing is finite", () => {
    expect(extent([])).toBeNull();
    expect(extent([Number.NaN])).toBeNull();
  });
});

describe("niceTicks", () => {
  it("snaps to clean 1/2/5 steps covering the data", () => {
    expect(niceTicks(28.4, 31.2, 2)).toEqual([28, 30, 32]);
  });

  it("covers the full range even when the data is off-step", () => {
    const ticks = niceTicks(3, 97, 2);
    expect(ticks[0]).toBeLessThanOrEqual(3);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(97);
  });

  it("still spans a domain for a flat series", () => {
    const ticks = niceTicks(30, 30, 2);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[ticks.length - 1]).toBeGreaterThan(ticks[0]);
  });

  it("handles an all-zero series", () => {
    const ticks = niceTicks(0, 0, 2);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThan(0);
  });

  it("falls back to a unit domain for non-finite input", () => {
    expect(niceTicks(Number.NaN, 5)).toEqual([0, 1]);
  });
});

describe("buildSeries", () => {
  const opts = {
    width: 100,
    height: 50,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    yDomain: [0, 10] as [number, number],
  };

  it("maps a known series to known path points", () => {
    const geom = buildSeries(
      [
        { x: 0, y: 0 },
        { x: 1, y: 10 },
        { x: 2, y: 5 },
      ],
      opts
    );

    expect(geom).not.toBeNull();
    // x spans the box left→right; y is inverted (0 at the bottom edge).
    expect(geom?.points).toEqual([
      { x: 0, y: 50 },
      { x: 50, y: 0 },
      { x: 100, y: 25 },
    ]);
    expect(geom?.line).toBe("M0,50L50,0L100,25");
    // The area closes down to the baseline and back to the first x.
    expect(geom?.area).toBe("M0,50L50,0L100,25L100,50L0,50Z");
    expect(geom?.first).toEqual({ x: 0, y: 50 });
    expect(geom?.last).toEqual({ x: 100, y: 25 });
  });

  it("honours the insets when placing marks", () => {
    const geom = buildSeries(
      [
        { x: 0, y: 0 },
        { x: 1, y: 10 },
      ],
      { ...opts, insets: { top: 5, right: 10, bottom: 5, left: 20 } }
    );

    expect(geom?.points).toEqual([
      { x: 20, y: 45 },
      { x: 90, y: 5 },
    ]);
  });

  it("projects against a shared x domain, not its own extent", () => {
    const shared: [number, number] = [0, 4];
    const geom = buildSeries(
      [
        { x: 1, y: 0 },
        { x: 3, y: 10 },
      ],
      { ...opts, xDomain: shared }
    );

    // 1/4 and 3/4 of the axis — the series does not stretch to fill it.
    expect(geom?.points).toEqual([
      { x: 25, y: 50 },
      { x: 75, y: 0 },
    ]);
  });

  it("derives a nice-tick y domain when none is given", () => {
    const geom = buildSeries(
      [
        { x: 0, y: 28.4 },
        { x: 1, y: 31.2 },
      ],
      { width: 100, height: 50, insets: { top: 0, right: 0, bottom: 0, left: 0 }, tickCount: 2 }
    );

    expect(geom?.yTicks).toEqual([28, 30, 32]);
    expect(geom?.yDomain).toEqual([28, 32]);
    // 28.4 sits 10% up a 28→32 domain of 50px → y = 50 - 5 = 45.
    expect(geom?.points[0]).toEqual({ x: 0, y: 45 });
  });

  it("centres a flat series instead of pinning it to an edge", () => {
    const geom = buildSeries(
      [
        { x: 0, y: 7 },
        { x: 1, y: 7 },
      ],
      { width: 100, height: 50, insets: { top: 0, right: 0, bottom: 0, left: 0 }, yDomain: [7, 7] }
    );

    expect(geom?.points).toEqual([
      { x: 0, y: 25 },
      { x: 100, y: 25 },
    ]);
  });

  it("places a single sample at the latest edge", () => {
    const geom = buildSeries([{ x: 5, y: 5 }], opts);
    expect(geom?.points).toEqual([{ x: 100, y: 25 }]);
  });

  it("carries no mark for a non-finite sample, and does not draw through it", () => {
    const geom = buildSeries(
      [
        { x: 0, y: 0 },
        { x: 1, y: Number.NaN },
        { x: 2, y: 10 },
      ],
      opts
    );
    expect(geom?.points).toHaveLength(2);
    // Two runs, not one segment bridging the hole.
    expect(geom?.runs).toHaveLength(2);
  });

  it("returns null for an empty series so callers can render an empty state", () => {
    expect(buildSeries([], opts)).toBeNull();
    expect(buildSeries([{ x: Number.NaN, y: 1 }], opts)).toBeNull();
  });

  // ─── Gaps ──────────────────────────────────────────────────────────
  //
  // A null reading is a gap, not a zero. Zero-filling would draw a line
  // claiming a real measurement (an ETA of zero, a speed of zero) that was
  // never taken, so the stroke has to break instead.

  it("breaks the line into separate runs across null gaps", () => {
    const geom = buildSeries(
      [
        { x: 0, y: 0 },
        { x: 1, y: null },
        { x: 2, y: 10 },
        { x: 3, y: 5 },
      ],
      opts
    );

    expect(geom?.runs).toHaveLength(2);
    expect(geom?.runs[0].line).toBe("M0,50");
    expect(geom?.runs[1].line).toBe("M66.67,0L100,25");
    // The combined path is two `M` subpaths — a break, not a segment through
    // the gap. This is the zero-fill regression guard at geometry level.
    expect(geom?.line).toBe("M0,50M66.67,0L100,25");
    expect(geom?.line).not.toContain("L66.67,0");
  });

  it("does not draw a gapped series the way it would draw a zero-filled one", () => {
    const gapped = buildSeries(
      [
        { x: 0, y: 8 },
        { x: 1, y: null },
        { x: 2, y: 8 },
      ],
      opts
    );
    const zeroFilled = buildSeries(
      [
        { x: 0, y: 8 },
        { x: 1, y: 0 },
        { x: 2, y: 8 },
      ],
      opts
    );

    expect(gapped?.line).not.toBe(zeroFilled?.line);
    // Nothing is plotted at the baseline for the missing sample.
    expect(gapped?.points).toHaveLength(2);
    expect(gapped?.points.some((p) => p.y === 50)).toBe(false);
  });

  it("keeps gap slots on the x axis so the samples either side stay put", () => {
    const withGap = buildSeries(
      [
        { x: 0, y: 4 },
        { x: 1, y: null },
        { x: 2, y: 8 },
      ],
      opts
    );
    const dropped = buildSeries(
      [
        { x: 0, y: 4 },
        { x: 2, y: 8 },
      ],
      opts
    );

    expect(withGap?.points).toEqual(dropped?.points);
    expect(withGap?.xDomain).toEqual([0, 2]);
  });

  it("closes an area subpath under each run", () => {
    const geom = buildSeries(
      [
        { x: 0, y: 0 },
        { x: 1, y: 10 },
        { x: 2, y: null },
        { x: 3, y: 10 },
      ],
      opts
    );

    expect(geom?.runs).toHaveLength(2);
    expect(geom?.runs[0].area).toBe("M0,50L33.33,0L33.33,50L0,50Z");
    expect(geom?.area).toBe(geom?.runs.map((run) => run.area).join(""));
  });

  it("anchors `last` on the latest reading, skipping trailing gaps", () => {
    const geom = buildSeries(
      [
        { x: 0, y: 0 },
        { x: 1, y: 10 },
        { x: 2, y: null },
      ],
      opts
    );

    // Index 1 of a 0..2 axis → half way across, at the top of the domain.
    expect(geom?.last).toEqual({ x: 50, y: 0 });
  });

  it("returns null when no sample carries a reading", () => {
    expect(buildSeries([{ x: 0, y: null }], opts)).toBeNull();
    expect(
      buildSeries(
        [
          { x: 0, y: null },
          { x: 1, y: null },
        ],
        opts
      )
    ).toBeNull();
  });

  // ─── Pinned axis ───────────────────────────────────────────────────

  it("pins the bottom of the axis to `yFloor` instead of auto-scaling", () => {
    const base = { width: 100, height: 50, insets: { top: 0, right: 0, bottom: 0, left: 0 } };
    const data = [
      { x: 0, y: 20 },
      { x: 1, y: 30 },
    ];

    // Auto-scaled: 20 sits on the floor of the box, so a near-flat series
    // looks like a full-height climb.
    expect(buildSeries(data, base)?.points).toEqual([
      { x: 0, y: 50 },
      { x: 100, y: 0 },
    ]);

    // Pinned at 0: the same series reads as the small change it is.
    const pinned = buildSeries(data, { ...base, yFloor: 0 });
    expect(pinned?.yDomain).toEqual([0, 30]);
    expect(pinned?.points).toEqual([
      { x: 0, y: 16.67 },
      { x: 100, y: 0 },
    ]);
  });

  it("pins the top of the axis to `yCeiling`", () => {
    const geom = buildSeries(
      [
        { x: 0, y: 0 },
        { x: 1, y: 50 },
      ],
      { width: 100, height: 50, insets: { top: 0, right: 0, bottom: 0, left: 0 }, yCeiling: 100 }
    );

    expect(geom?.yDomain).toEqual([0, 100]);
    expect(geom?.points[1]).toEqual({ x: 100, y: 25 });
  });

  it("skips nice ticks on a pinned axis — the pin is the domain", () => {
    const geom = buildSeries(
      [
        { x: 0, y: 3 },
        { x: 1, y: 57 },
      ],
      { width: 100, height: 50, insets: { top: 0, right: 0, bottom: 0, left: 0 }, yFloor: 0 }
    );

    expect(geom?.yTicks).toEqual([]);
    expect(geom?.yDomain).toEqual([0, 57]);
  });

  it("clamps readings that fall outside a pinned axis", () => {
    const geom = buildSeries(
      [
        { x: 0, y: -5 },
        { x: 1, y: 10 },
      ],
      { width: 100, height: 50, insets: { top: 0, right: 0, bottom: 0, left: 0 }, yFloor: 0 }
    );

    // −5 is drawn on the pinned floor, not below the box.
    expect(geom?.points[0]).toEqual({ x: 0, y: 50 });
  });

  it("keeps a flat pinned series on the baseline instead of dividing by zero", () => {
    const geom = buildSeries(
      [
        { x: 0, y: 7 },
        { x: 1, y: 7 },
        { x: 2, y: 7 },
      ],
      { width: 100, height: 50, insets: { top: 0, right: 0, bottom: 0, left: 0 }, yFloor: 7 }
    );

    expect(geom?.line).toBe("M0,50L50,50L100,50");
  });
});

describe("nearestIndexForFraction", () => {
  it("snaps to the nearest sample", () => {
    expect(nearestIndexForFraction(5, 0)).toBe(0);
    expect(nearestIndexForFraction(5, 0.5)).toBe(2);
    expect(nearestIndexForFraction(5, 1)).toBe(4);
    expect(nearestIndexForFraction(5, 0.3)).toBe(1);
  });

  it("clamps out-of-range fractions", () => {
    expect(nearestIndexForFraction(5, -2)).toBe(0);
    expect(nearestIndexForFraction(5, 9)).toBe(4);
  });

  it("handles degenerate counts", () => {
    expect(nearestIndexForFraction(0, 0.5)).toBe(-1);
    expect(nearestIndexForFraction(1, 0.9)).toBe(0);
  });
});

describe("downsample", () => {
  it("keeps short series untouched", () => {
    const items = [1, 2, 3];
    expect(downsample(items, 10)).toBe(items);
  });

  it("thins evenly and keeps the endpoints", () => {
    const items = Array.from({ length: 101 }, (_, i) => i);
    const thinned = downsample(items, 11);
    expect(thinned).toHaveLength(11);
    expect(thinned[0]).toBe(0);
    expect(thinned[thinned.length - 1]).toBe(100);
    expect(thinned).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });
});

describe("formatTimeTick", () => {
  it("renders HH:MM", () => {
    expect(formatTimeTick(Date.UTC(2026, 0, 1, 12, 34))).toMatch(/^\d{2}:\d{2}$/);
  });

  it("degrades gracefully for a non-finite timestamp", () => {
    expect(formatTimeTick(Number.NaN)).toBe("—");
  });
});
