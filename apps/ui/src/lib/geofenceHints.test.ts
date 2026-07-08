import { describe, it, expect } from "vitest";
import { drawProgressHint, MIN_GEOFENCE_VERTICES } from "./geofenceHints";

describe("drawProgressHint", () => {
  it("prompts for the first points when the polygon is empty", () => {
    expect(drawProgressHint(0)).toBe(
      `Click the map to add points (at least ${MIN_GEOFENCE_VERTICES})`
    );
  });

  it("counts down remaining points while still short of the minimum", () => {
    expect(drawProgressHint(1)).toBe("1 point placed, add 2 more");
    expect(drawProgressHint(2)).toBe("2 points placed, add 1 more");
  });

  it("returns null once the polygon has enough vertices to confirm", () => {
    expect(drawProgressHint(MIN_GEOFENCE_VERTICES)).toBeNull();
    expect(drawProgressHint(MIN_GEOFENCE_VERTICES + 5)).toBeNull();
  });
});
