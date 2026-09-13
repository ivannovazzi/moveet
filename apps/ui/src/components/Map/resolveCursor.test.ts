import { describe, it, expect } from "vitest";
import { resolveCursor } from "./resolveCursor";

const IDLE = { isDragging: false, isHovering: false };

describe("resolveCursor", () => {
  it("keeps the idle cursor when deck reports nothing", () => {
    expect(resolveCursor("grab", IDLE)).toBe("grab");
    expect(resolveCursor("default", IDLE)).toBe("default");
  });

  it("shows the pointer over a pickable object for every idle cursor", () => {
    expect(resolveCursor("grab", { isDragging: false, isHovering: true })).toBe("pointer");
    // The edit-heatzone regression: `default` used to short-circuit, so handles
    // and vehicles under the pointer gave no hover feedback at all.
    expect(resolveCursor("default", { isDragging: false, isHovering: true })).toBe("pointer");
  });

  it("shows grabbing only while panning under grab", () => {
    expect(resolveCursor("grab", { isDragging: true, isHovering: false })).toBe("grabbing");
    // Pan is locked under `default`; a drag there is a handle drag, not a pan.
    expect(resolveCursor("default", { isDragging: true, isHovering: false })).toBe("default");
  });

  it("lets an explicit mode cursor win over hover and drag", () => {
    for (const cursor of ["crosshair", "wait", "grabbing"]) {
      expect(resolveCursor(cursor, { isDragging: true, isHovering: true })).toBe(cursor);
      expect(resolveCursor(cursor, IDLE)).toBe(cursor);
    }
  });

  it("prefers the drag state over the hover state", () => {
    expect(resolveCursor("grab", { isDragging: true, isHovering: true })).toBe("grabbing");
  });
});
