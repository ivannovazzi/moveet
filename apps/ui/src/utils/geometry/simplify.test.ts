import { describe, it, expect } from "vitest";
import { simplifyPath, closeRing, ringArea } from "./simplify";

describe("simplifyPath (Douglas–Peucker)", () => {
  it("returns the input unchanged when it has 2 or fewer points", () => {
    const line: [number, number][] = [
      [0, 0],
      [1, 1],
    ];
    expect(simplifyPath(line, 0.1)).toEqual(line);
  });

  it("drops near-collinear interior points but preserves the endpoints", () => {
    // A straight run along y=0 with tiny jitter well under tolerance.
    const path: [number, number][] = [
      [0, 0],
      [1, 0.0001],
      [2, -0.0001],
      [3, 0.0001],
      [4, 0],
    ];
    const result = simplifyPath(path, 0.01);
    expect(result[0]).toEqual([0, 0]);
    expect(result[result.length - 1]).toEqual([4, 0]);
    expect(result.length).toBeLessThan(path.length);
  });

  it("keeps a point that deviates more than the tolerance", () => {
    const path: [number, number][] = [
      [0, 0],
      [1, 1], // large deviation from the [0,0]-[2,0] baseline
      [2, 0],
    ];
    const result = simplifyPath(path, 0.1);
    expect(result).toEqual(path);
  });

  it("reduces a dense freehand-style stroke to a handful of vertices", () => {
    // 100 points sampled along a straight diagonal with sub-tolerance noise.
    const path: [number, number][] = [];
    for (let i = 0; i <= 100; i++) {
      path.push([i / 100, i / 100 + (i % 2 === 0 ? 0.00005 : -0.00005)]);
    }
    const result = simplifyPath(path, 0.01);
    expect(result.length).toBeLessThan(10);
    expect(result[0]).toEqual(path[0]);
    expect(result[result.length - 1]).toEqual(path[path.length - 1]);
  });
});

describe("closeRing", () => {
  it("appends the first point when the ring is open", () => {
    const ring: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
    ];
    const closed = closeRing(ring);
    expect(closed).toHaveLength(4);
    expect(closed[closed.length - 1]).toEqual(closed[0]);
  });

  it("leaves an already-closed ring untouched", () => {
    const ring: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ];
    expect(closeRing(ring)).toEqual(ring);
  });
});

describe("ringArea", () => {
  it("computes the absolute shoelace area of a unit square", () => {
    const square: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    expect(ringArea(square)).toBeCloseTo(1, 10);
  });

  it("is orientation-independent (returns a positive area)", () => {
    const cw: [number, number][] = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ];
    expect(ringArea(cw)).toBeCloseTo(1, 10);
  });

  it("returns 0 for a degenerate (collinear) ring", () => {
    const line: [number, number][] = [
      [0, 0],
      [1, 0],
      [2, 0],
    ];
    expect(ringArea(line)).toBeCloseTo(0, 10);
  });
});
