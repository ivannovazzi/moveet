import { describe, expect, it } from "vitest";
import {
  degreesPerPixel,
  hexLatticePaths,
  hexLod,
  latitudeSquash,
  snapBounds,
  type GeoBounds,
  type HexPath,
} from "../hexLattice";

const SQRT3 = Math.sqrt(3);

describe("degreesPerPixel", () => {
  it("halves with every zoom level", () => {
    expect(degreesPerPixel(11) / degreesPerPixel(12)).toBeCloseTo(2, 10);
  });

  it("spans the world across deck.gl's 512px tile at zoom 0", () => {
    expect(degreesPerPixel(0) * 512).toBeCloseTo(360, 10);
  });
});

describe("hexLod", () => {
  it("picks a power-of-two cell size", () => {
    for (let zoom = 1; zoom <= 22; zoom += 0.25) {
      const { primary } = hexLod(zoom);
      expect(Math.log2(primary)).toBeCloseTo(Math.round(Math.log2(primary)), 10);
    }
  });

  it("keeps the on-screen cell width inside a factor of two of the target", () => {
    for (let zoom = 4; zoom <= 20; zoom += 0.25) {
      const widthPx = (SQRT3 * hexLod(zoom).primary) / degreesPerPixel(zoom);
      expect(widthPx).toBeGreaterThan(60);
      expect(widthPx).toBeLessThan(140);
    }
  });

  it("gets finer as you zoom in, never coarser", () => {
    let previous = Infinity;
    for (let zoom = 4; zoom <= 20; zoom += 0.25) {
      const { primary } = hexLod(zoom);
      expect(primary).toBeLessThanOrEqual(previous);
      previous = primary;
    }
  });

  it("draws one lattice for most of a rung", () => {
    const solo = [];
    for (let zoom = 4; zoom <= 20; zoom += 0.02) {
      if (hexLod(zoom).secondary === null) solo.push(zoom);
    }
    // The crossfade zone is deliberately narrow.
    expect(solo.length / ((20 - 4) / 0.02)).toBeGreaterThan(0.5);
  });

  it("only ever crossfades with an adjacent rung", () => {
    for (let zoom = 4; zoom <= 20; zoom += 0.05) {
      const { primary, secondary } = hexLod(zoom);
      if (secondary === null) continue;
      expect([primary / 2, primary * 2]).toContain(secondary);
    }
  });

  it("never lets either lattice's share jump", () => {
    // Total opacity is split between the two, so `share` is what each layer
    // multiplies its alpha by. Walking the zoom range, no step may move a
    // share by more than the step itself could account for.
    let previous: { size: number; share: number }[] | null = null;
    for (let zoom = 20; zoom >= 4; zoom -= 0.01) {
      const { primary, secondary, mix } = hexLod(zoom);
      const current = [
        { size: primary, share: 1 - mix },
        ...(secondary === null ? [] : [{ size: secondary, share: mix }]),
      ];
      if (previous) {
        for (const now of current) {
          const before = previous.find((p) => p.size === now.size);
          // A lattice that wasn't on screen must enter at ~0, not mid-ramp.
          expect(Math.abs(now.share - (before?.share ?? 0))).toBeLessThan(0.05);
        }
      }
      previous = current;
    }
  });

  it("hands over at exactly half and half, so neither side pops", () => {
    // Sweep for the boundary: the rung flips where mix is at its peak.
    let peak = 0;
    for (let zoom = 4; zoom <= 20; zoom += 0.001) {
      peak = Math.max(peak, hexLod(zoom).mix);
    }
    expect(peak).toBeCloseTo(0.5, 2);
  });

  it("falls back to a usable size for a non-finite zoom", () => {
    expect(hexLod(Number.NaN).primary).toBeGreaterThan(0);
  });
});

describe("latitudeSquash", () => {
  it("leaves the lattice alone at the equator", () => {
    expect(latitudeSquash(0)).toBeCloseTo(1, 10);
  });

  it("compresses it toward the poles, where a degree of latitude is taller", () => {
    expect(latitudeSquash(40.7)).toBeLessThan(0.8);
    expect(latitudeSquash(40.7)).toBeGreaterThan(0.7);
  });

  it("is symmetric about the equator", () => {
    expect(latitudeSquash(-1.29)).toBe(latitudeSquash(1.29));
  });

  it("quantizes, so panning north doesn't slide every row", () => {
    expect(latitudeSquash(40.7)).toBe(latitudeSquash(40.9));
  });

  it("stays positive for a non-finite or extreme latitude", () => {
    expect(latitudeSquash(Number.NaN)).toBeGreaterThan(0);
    expect(latitudeSquash(90)).toBeGreaterThan(0);
  });
});

describe("snapBounds", () => {
  const bounds: GeoBounds = [
    [36.7123, -1.3456],
    [36.9321, -1.1234],
  ];

  it("grows the box outward to whole blocks", () => {
    const [[west, south], [east, north]] = snapBounds(bounds, 0.03125, 6);
    expect(west).toBeLessThanOrEqual(36.7123);
    expect(south).toBeLessThanOrEqual(-1.3456);
    expect(east).toBeGreaterThanOrEqual(36.9321);
    expect(north).toBeGreaterThanOrEqual(-1.1234);
  });

  it("returns the same box for two nearby viewports", () => {
    const nudged: GeoBounds = [
      [36.7133, -1.3446],
      [36.9331, -1.1224],
    ];
    expect(snapBounds(nudged, 0.03125, 6)).toEqual(snapBounds(bounds, 0.03125, 6));
  });
});

describe("hexLatticePaths", () => {
  const size = 0.01;
  const bounds: GeoBounds = [
    [0, 0],
    [0.1, 0.1],
  ];

  /** Every segment in the lattice, as endpoint pairs. */
  function segments(paths: HexPath[]) {
    const out: [[number, number], [number, number]][] = [];
    for (const path of paths) {
      for (let i = 1; i < path.length; i++) out.push([path[i - 1], path[i]]);
    }
    return out;
  }

  /** A segment's identity, independent of which way round it was drawn. */
  const key = ([a, b]: [[number, number], [number, number]]) => {
    const round = (v: number) => Math.round(v * 1e9);
    const one = `${round(a[0])},${round(a[1])}`;
    const two = `${round(b[0])},${round(b[1])}`;
    return one < two ? `${one}|${two}` : `${two}|${one}`;
  };

  it("covers the requested box", () => {
    const paths = hexLatticePaths(bounds, size, 1);
    const xs = paths.flat().map(([x]) => x);
    const ys = paths.flat().map(([, y]) => y);
    expect(Math.min(...xs)).toBeLessThanOrEqual(0);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(0.1);
    expect(Math.min(...ys)).toBeLessThanOrEqual(0);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(0.1);
  });

  it("draws every edge exactly once", () => {
    const all = segments(hexLatticePaths(bounds, size, 1)).map(key);
    expect(new Set(all).size).toBe(all.length);
  });

  it("builds real hexagons: every edge is one cell side long", () => {
    const expected = size; // circumradius == side length for a regular hexagon
    for (const [a, b] of segments(hexLatticePaths(bounds, size, 1))) {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      expect(length).toBeCloseTo(expected, 9);
    }
  });

  it("uses only the three honeycomb directions, never an axis-aligned run", () => {
    // 90° (the struts) and ±30° (the zigzags). Nothing horizontal, which is
    // the whole reason this replaced a square grid over a street grid.
    const angles = new Set<number>();
    for (const [a, b] of segments(hexLatticePaths(bounds, size, 1))) {
      const deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      angles.add(Math.round(((deg % 180) + 180) % 180));
    }
    expect([...angles].sort((x, y) => x - y)).toEqual([30, 90, 150]);
  });

  it("is anchored to the world, not to the box it was asked for", () => {
    const shifted = hexLatticePaths(
      [
        [0.02, 0.02],
        [0.08, 0.08],
      ],
      size,
      1
    );
    const wide = hexLatticePaths(bounds, size, 1);
    const wideKeys = new Set(segments(wide).map(key));
    // Every edge of the smaller request also exists in the larger one: the two
    // agree on where the lattice is, so panning cannot make it jump.
    for (const segment of segments(shifted)) {
      expect(wideKeys.has(key(segment))).toBe(true);
    }
  });

  it("squashes in latitude without touching longitude", () => {
    const plain = hexLatticePaths(bounds, size, 1);
    const squashed = hexLatticePaths(bounds, size, 0.5);
    const height = (paths: HexPath[]) => {
      const ys = paths.flat().map(([, y]) => y);
      return Math.max(...ys) - Math.min(...ys);
    };
    const width = (paths: HexPath[]) => {
      const xs = paths.flat().map(([x]) => x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(width(squashed)).toBeCloseTo(width(plain), 9);
    expect(height(squashed)).toBeLessThan(height(plain));
  });

  it("returns nothing for a degenerate size or squash", () => {
    expect(hexLatticePaths(bounds, 0, 1)).toEqual([]);
    expect(hexLatticePaths(bounds, -1, 1)).toEqual([]);
    expect(hexLatticePaths(bounds, size, 0)).toEqual([]);
  });

  it("bails rather than building a lattice the ladder would never ask for", () => {
    expect(
      hexLatticePaths(
        [
          [-180, -85],
          [180, 85],
        ],
        0.0001,
        1
      )
    ).toEqual([]);
  });
});
