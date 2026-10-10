import { describe, expect, it } from "vitest";
import { douglasPeucker, simplifyPolygons, simplifyRing } from "../../modules/maps/simplify";

/** A circle-ish ring with `n` points, radius `r` degrees. */
function circle(n: number, r: number, cx = 0, cy = 0): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  ring.push(ring[0]);
  return ring;
}

describe("douglasPeucker", () => {
  it("drops points closer to the line than the tolerance and keeps the ends", () => {
    const line: [number, number][] = [
      [0, 0],
      [1, 0.001],
      [2, -0.001],
      [3, 1],
      [4, 0],
    ];
    expect(douglasPeucker(line, 0.01)).toEqual([
      [0, 0],
      [2, -0.001],
      [3, 1],
      [4, 0],
    ]);
    expect(douglasPeucker(line, 2)).toEqual([
      [0, 0],
      [4, 0],
    ]);
  });
});

describe("simplifyRing", () => {
  it("shrinks a dense ring, keeps it closed and rounds to 3 decimals", () => {
    const out = simplifyRing(circle(2000, 5), 0.05);
    expect(out).not.toBeNull();
    const ring = out as [number, number][];
    expect(ring.length).toBeLessThan(200);
    expect(ring.length).toBeGreaterThan(8);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const [x, y] of ring) {
      expect(Math.round(x * 1000) / 1000).toBe(x);
      expect(Math.round(y * 1000) / 1000).toBe(y);
    }
  });

  it("drops a ring that is a speck at this tolerance", () => {
    expect(simplifyRing(circle(50, 0.001), 0.05)).toBeNull();
  });
});

describe("simplifyPolygons", () => {
  it("keeps holes that survive and drops polygons that vanish", () => {
    const out = simplifyPolygons(
      [[circle(500, 5), circle(200, 1)], [circle(50, 0.0001, 20, 20)]],
      0.05
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(2);
  });
});
