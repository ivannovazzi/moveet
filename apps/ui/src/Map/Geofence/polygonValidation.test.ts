import { describe, it, expect } from "vitest";
import { segmentsIntersect, isSelfIntersecting } from "./polygonValidation";

describe("segmentsIntersect", () => {
  it("returns true for two crossing segments", () => {
    // X shape: (0,0)→(2,2) crosses (0,2)→(2,0)
    expect(segmentsIntersect([0, 0], [2, 2], [0, 2], [2, 0])).toBe(true);
  });

  it("returns false for two parallel segments", () => {
    // horizontal parallels
    expect(segmentsIntersect([0, 0], [2, 0], [0, 1], [2, 1])).toBe(false);
  });

  it("returns false for two non-crossing segments", () => {
    // L shape — segments don't overlap
    expect(segmentsIntersect([0, 0], [1, 0], [2, 0], [2, 1])).toBe(false);
  });

  it("returns false for collinear segments", () => {
    // same line, overlapping range — cross product is zero
    expect(segmentsIntersect([0, 0], [2, 0], [1, 0], [3, 0])).toBe(false);
  });

  it("returns false when segments touch at an endpoint", () => {
    // shared point at (1,1) — strict inequality excludes endpoints
    expect(segmentsIntersect([0, 0], [1, 1], [1, 1], [2, 0])).toBe(false);
  });

  it("returns false for T-junction touching at midpoint of one segment", () => {
    // (0,0)→(2,0) and (1,0)→(1,2) — they touch at (1,0) which is endpoint of second
    expect(segmentsIntersect([0, 0], [2, 0], [1, 0], [1, 2])).toBe(false);
  });

  it("returns true for segments that cross in the middle", () => {
    // diagonal cross at (1,1)
    expect(segmentsIntersect([0, 0], [2, 2], [2, 0], [0, 2])).toBe(true);
  });
});

describe("isSelfIntersecting", () => {
  it("returns false for a simple square", () => {
    const square: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    expect(isSelfIntersecting(square)).toBe(false);
  });

  it("returns true for a figure-8 (bowtie) polygon", () => {
    // vertices trace a crossing shape: edge 0→1 crosses edge 2→3
    const bowtie: [number, number][] = [
      [0, 0],
      [2, 2],
      [2, 0],
      [0, 2],
    ];
    expect(isSelfIntersecting(bowtie)).toBe(true);
  });

  it("returns false for a triangle", () => {
    const triangle: [number, number][] = [
      [0, 0],
      [2, 0],
      [1, 2],
    ];
    expect(isSelfIntersecting(triangle)).toBe(false);
  });

  it("returns false for a complex non-intersecting polygon (L-shape)", () => {
    // L-shaped hexagon — no edges cross
    const lShape: [number, number][] = [
      [0, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [1, 2],
      [0, 2],
    ];
    expect(isSelfIntersecting(lShape)).toBe(false);
  });

  it("returns false for a convex pentagon", () => {
    const pentagon: [number, number][] = [
      [1, 0],
      [2, 1],
      [1.5, 2],
      [0.5, 2],
      [0, 1],
    ];
    expect(isSelfIntersecting(pentagon)).toBe(false);
  });

  it("returns true for a star-shaped self-intersecting polygon", () => {
    // Star drawn by connecting every other point of a regular pentagon
    // This creates a pentagram with many crossings
    const star: [number, number][] = [
      [0, 3],
      [3, -2],
      [-3, 1],
      [3, 1],
      [-3, -2],
    ];
    expect(isSelfIntersecting(star)).toBe(true);
  });
});
