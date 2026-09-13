import { describe, expect, it } from "vitest";
import { anchorOffset } from "./dockRowLayout";

/**
 * Where a floating dock surface lands. The rule these pin is that the *bar*
 * never moves to accommodate a panel: the panel is placed relative to the bar,
 * and clamped inside the viewport when it would overhang.
 */
describe("anchorOffset", () => {
  const base = { elementWidth: 460, viewportWidth: 1440 };

  it("lines a panel up with the key that opened it", () => {
    expect(anchorOffset({ ...base, originLeft: 900, anchorLeft: 960 })).toBe(60);
  });

  it("pulls the panel's padding back under the key's label", () => {
    expect(anchorOffset({ ...base, originLeft: 900, anchorLeft: 960, inset: 10 })).toBe(50);
  });

  it("aligns a section panel's right edge with the bar's right edge", () => {
    // Bar: 900 → 1140. A 460-wide panel ends at 1140, so it starts at 680 —
    // 220px left of the bar's own left edge.
    expect(
      anchorOffset({
        ...base,
        originLeft: 900,
        originRight: 1140,
        anchorLeft: 1000,
        align: "origin-right",
      })
    ).toBe(-220);
  });

  it("holds still whichever key inside the bar is lit", () => {
    const at = (anchorLeft: number) =>
      anchorOffset({
        ...base,
        originLeft: 900,
        originRight: 1140,
        anchorLeft,
        align: "origin-right",
      });

    expect(at(910)).toBe(at(1090));
  });

  it("keeps a right-aligned panel inside the viewport on a narrow screen", () => {
    // A 460-wide panel cannot fit inside a 480px viewport's margins, so it is
    // parked at the left margin instead of hanging off the bar's right edge.
    const offset = anchorOffset({
      elementWidth: 460,
      viewportWidth: 480,
      originLeft: 400,
      originRight: 480,
      anchorLeft: 410,
      align: "origin-right",
    });

    expect(400 + offset).toBe(12);
  });

  it("slides left of whatever already holds the right edge, such as an open inspector", () => {
    // Bar at 1000..1200 on a 1440 screen; a 460 panel would end flush at 1200.
    // With 348px reserved for the inspector the panel's right edge stops at
    // 1440 - 12 - 348 = 1080 instead.
    const offset = anchorOffset({
      elementWidth: 460,
      viewportWidth: 1440,
      originLeft: 1000,
      originRight: 1200,
      anchorLeft: 1010,
      align: "origin-right",
      reserveRight: 348,
    });

    expect(1000 + offset + 460).toBe(1080);
  });
});
