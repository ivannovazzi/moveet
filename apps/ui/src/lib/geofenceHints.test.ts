import { describe, it, expect } from "vitest";
import { MIN_GEOFENCE_VERTICES, drawProgressHint } from "./geofenceHints";

describe("drawProgressHint", () => {
  it("prompts to start when no points are placed", () => {
    expect(drawProgressHint(0)).toBe("Click the map to add points — at least 3");
  });

  it("counts remaining points (singular/plural) while below the minimum", () => {
    expect(drawProgressHint(1)).toBe("1 point — add 2 more");
    expect(drawProgressHint(2)).toBe("2 points — add 1 more");
  });

  it("returns null once the polygon has enough vertices to confirm", () => {
    expect(drawProgressHint(MIN_GEOFENCE_VERTICES)).toBeNull();
    expect(drawProgressHint(5)).toBeNull();
  });

  it("keys the wording off the shared min-vertex constant", () => {
    // Guards the two call sites (ModeBanner + GeofencePanel) against drifting apart.
    expect(MIN_GEOFENCE_VERTICES).toBe(3);
  });
});
