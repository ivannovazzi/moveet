import { describe, expect, it } from "vitest";
import { anchorOffset } from "./dockRowLayout";

/**
 * Where the dock's one floating surface lands. The rule these pin is that the
 * *bar* never moves to accommodate the popover: the popover is placed relative
 * to the bar, and clamped inside the viewport when it would overhang.
 *
 * There used to be a second set of rules here, for the section panel: align to
 * the bar's right edge rather than to a key, and slide left of whatever the
 * inspector had claimed. Both of those surfaces are the console now, which
 * holds its own space, so neither rule has anything left to describe.
 */
describe("anchorOffset", () => {
  const base = { elementWidth: 460, viewportWidth: 1440 };

  it("lines a panel up with the key that opened it", () => {
    expect(anchorOffset({ ...base, originLeft: 900, anchorLeft: 960 })).toBe(60);
  });

  it("pulls the panel's padding back under the key's label", () => {
    expect(anchorOffset({ ...base, originLeft: 900, anchorLeft: 960, inset: 10 })).toBe(50);
  });

  it("keeps a panel inside the viewport on a narrow screen", () => {
    // A 460-wide panel cannot fit inside a 480px viewport's margins, so it is
    // parked at the left margin rather than hanging off the right of the screen.
    const offset = anchorOffset({
      elementWidth: 460,
      viewportWidth: 480,
      originLeft: 400,
      anchorLeft: 410,
    });

    expect(400 + offset).toBe(12);
  });
});
