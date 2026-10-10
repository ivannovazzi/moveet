import { describe, expect, it } from "vitest";
import {
  boxFromCorners,
  moveBox,
  projectLngLat,
  resizeBox,
  unprojectPx,
  viewForBbox,
  WORLD_VIEW,
} from "./geometry";

const W = 800;
const H = 600;

describe("picker geometry", () => {
  it("round-trips screen and world coordinates at any zoom", () => {
    for (const zoom of [0.5, 4, 12]) {
      const view = { ...WORLD_VIEW, longitude: 9.67, latitude: 45.69, zoom };
      const px = projectLngLat(view, W, H, [9.7, 45.71]);
      const back = unprojectPx(view, W, H, px);
      expect(back?.[0]).toBeCloseTo(9.7, 6);
      expect(back?.[1]).toBeCloseTo(45.71, 6);
    }
  });

  it("frames a box: its corners land inside the canvas", () => {
    const bbox: [number, number, number, number] = [9.64, 45.68, 9.7, 45.71];
    const view = viewForBbox(bbox, W, H, 48);
    const [x0, y0] = projectLngLat(view, W, H, [bbox[0], bbox[3]]);
    const [x1, y1] = projectLngLat(view, W, H, [bbox[2], bbox[1]]);
    for (const v of [x0, x1]) expect(v).toBeGreaterThanOrEqual(47);
    for (const v of [x0, x1]) expect(v).toBeLessThanOrEqual(W - 47);
    for (const v of [y0, y1]) expect(v).toBeGreaterThanOrEqual(47);
    for (const v of [y0, y1]) expect(v).toBeLessThanOrEqual(H - 47);
    expect(view.zoom).toBeGreaterThan(10);
  });

  it("normalizes and clamps corners to the world", () => {
    expect(boxFromCorners([10, 50], [5, 40])).toEqual([5, 40, 10, 50]);
    expect(boxFromCorners([-200, -89], [190, 89])).toEqual([-180, -85, 180, 85]);
  });

  it("resizes from a handle, flipping past the opposite edge", () => {
    const box: [number, number, number, number] = [0, 0, 10, 10];
    expect(resizeBox(box, "ne", [12, 14])).toEqual([0, 0, 12, 14]);
    expect(resizeBox(box, "w", [3, 99])).toEqual([3, 0, 10, 10]);
    expect(resizeBox(box, "s", [0, 20])).toEqual([0, 10, 10, 20]);
  });

  it("moves a box whole, stopping at the world's edge", () => {
    expect(moveBox([0, 0, 10, 10], 5, -3)).toEqual([5, -3, 15, 7]);
    expect(moveBox([170, 0, 179, 10], 5, 0)).toEqual([171, 0, 180, 10]);
  });
});
