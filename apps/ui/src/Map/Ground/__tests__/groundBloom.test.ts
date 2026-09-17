import { describe, expect, it } from "vitest";
import { FIELD_SIZE, fieldToRgba, padBounds, rasterizeDensity, smoothField } from "../groundBloom";
import type { GeoBounds } from "../hexLattice";

const BOUNDS: GeoBounds = [
  [0, 0],
  [1, 1],
];

/** Read a cell out of a square field. */
const at = (field: Float32Array, x: number, y: number, size = FIELD_SIZE) => field[y * size + x];

describe("padBounds", () => {
  it("grows the box by a fraction of its own span", () => {
    expect(padBounds(BOUNDS, 0.25)).toEqual([
      [-0.25, -0.25],
      [1.25, 1.25],
    ]);
  });

  it("scales the margin with the network, not with a fixed distance", () => {
    const wide: GeoBounds = [
      [0, 0],
      [10, 10],
    ];
    const [[west]] = padBounds(wide, 0.1);
    expect(west).toBeCloseTo(-1, 10);
  });
});

describe("rasterizeDensity", () => {
  it("bins points into the cell that contains them", () => {
    const field = rasterizeDensity([[0.5, 0.5]], BOUNDS, 4);
    expect(at(field, 2, 2, 4)).toBe(1);
    expect(field.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("counts repeats, so a dense junction weighs more than a lone vertex", () => {
    const field = rasterizeDensity(
      [
        [0.1, 0.1],
        [0.1, 0.1],
        [0.9, 0.9],
      ],
      BOUNDS,
      4
    );
    expect(at(field, 0, 0, 4)).toBe(2);
    expect(at(field, 3, 3, 4)).toBe(1);
  });

  it("drops points outside the box instead of clamping them to the edge", () => {
    const field = rasterizeDensity(
      [
        [2, 2],
        [-1, 0.5],
      ],
      BOUNDS,
      4
    );
    expect(field.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("returns an empty field for degenerate bounds rather than dividing by zero", () => {
    const field = rasterizeDensity(
      [[0, 0]],
      [
        [0, 0],
        [0, 0],
      ],
      4
    );
    expect(Array.from(field).every(Number.isFinite)).toBe(true);
    expect(field.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("smoothField", () => {
  it("normalises the peak to 1", () => {
    const raw = rasterizeDensity([[0.5, 0.5]], BOUNDS);
    const smooth = smoothField(raw);
    expect(Math.max(...smooth)).toBeCloseTo(1, 6);
  });

  it("spreads a single vertex out instead of leaving one hot cell", () => {
    const smooth = smoothField(rasterizeDensity([[0.5, 0.5]], BOUNDS));
    const lit = Array.from(smooth).filter((v) => v > 0.01).length;
    expect(lit).toBeGreaterThan(100);
  });

  it("falls to zero at the edges, so the bitmap's own border never shows", () => {
    // A point pushed hard against one corner: without the edge mask its blur
    // would still be bright where the bitmap ends.
    const smooth = smoothField(rasterizeDensity([[0.01, 0.01]], BOUNDS));
    for (let i = 0; i < FIELD_SIZE; i++) {
      expect(at(smooth, i, 0)).toBe(0);
      expect(at(smooth, i, FIELD_SIZE - 1)).toBe(0);
      expect(at(smooth, 0, i)).toBe(0);
      expect(at(smooth, FIELD_SIZE - 1, i)).toBe(0);
    }
  });

  it("stays flat and finite when the network has no vertices at all", () => {
    const smooth = smoothField(new Float32Array(FIELD_SIZE * FIELD_SIZE));
    expect(Array.from(smooth).every((v) => v === 0)).toBe(true);
  });

  it("lifts the midtones, or the bloom is a few hot dots on a dead field", () => {
    const smooth = smoothField(rasterizeDensity([[0.5, 0.5]], BOUNDS));
    const lit = Array.from(smooth).filter((v) => v > 0.01);
    const bright = lit.filter((v) => v > 0.5);
    // Raw density is long-tailed enough that a linear ramp leaves most of the
    // blur down in the noise; the gamma lift is what puts a real share of it
    // into the visible half of the range.
    expect(bright.length / lit.length).toBeGreaterThan(0.2);
  });
});

describe("fieldToRgba", () => {
  const lift = [40, 44, 52] as const;
  const core = [70, 60, 110] as const;

  it("turns density into alpha and leaves the tint to the colours", () => {
    const size = 2;
    const field = new Float32Array([0, 0, 1, 0]);
    const pixels = fieldToRgba(field, lift, core, size);
    // Row 0 of the canvas is the field's TOP row (north), i.e. index 2..3.
    expect(pixels[3]).toBeGreaterThan(200);
    expect([pixels[0], pixels[1], pixels[2]]).toEqual([70, 60, 110]);
    // The unlit cells are fully transparent.
    expect(pixels[size * size * 4 - 1]).toBe(0);
  });

  it("flips the field north-up for the canvas", () => {
    const field = new Float32Array([1, 0, 0, 0]); // south-west cell
    const pixels = fieldToRgba(field, lift, core, 2);
    const alphaAt = (x: number, y: number) => pixels[(y * 2 + x) * 4 + 3];
    expect(alphaAt(0, 1)).toBeGreaterThan(0);
    expect(alphaAt(0, 0)).toBe(0);
  });

  it("only shifts toward the core tint at the very top of the ramp", () => {
    const field = new Float32Array([0.5, 0, 0, 0]);
    const pixels = fieldToRgba(field, lift, core, 2);
    const red = pixels[(1 * 2 + 0) * 4];
    // Halfway up the field is a quarter of the way to the core colour:
    // 40 + (70 - 40) * 0.5^2, rounded by the clamped array.
    expect(red).toBe(48);
  });
});
