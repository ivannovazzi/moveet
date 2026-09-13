import { beforeEach, describe, expect, it } from "vitest";
import {
  clearInset,
  fitPadding,
  getInsets,
  MIN_VISIBLE,
  NO_INSETS,
  resetInsets,
  setInset,
  visibleCentre,
} from "./mapInsets";

beforeEach(() => resetInsets());

describe("the map inset register", () => {
  it("is empty until something claims a band", () => {
    expect(getInsets()).toEqual(NO_INSETS);
  });

  it("takes the largest claim per side rather than adding them up", () => {
    // Two panels stacked over the same edge cover that edge once.
    setInset("inspector", { right: 348 });
    setInset("section-panel", { right: 468, bottom: 540 });

    expect(getInsets()).toEqual({ top: 0, right: 468, bottom: 540, left: 0 });
  });

  it("replaces a key's previous claim instead of accumulating", () => {
    setInset("panel", { right: 468 });
    setInset("panel", { right: 200 });

    expect(getInsets().right).toBe(200);
  });

  it("gives the side back when the contributor leaves", () => {
    setInset("chrome", { bottom: 86 });
    setInset("panel", { bottom: 540 });
    expect(getInsets().bottom).toBe(540);

    clearInset("panel");
    expect(getInsets().bottom).toBe(86);

    clearInset("panel");
    expect(getInsets().bottom).toBe(86);
  });
});

describe("visibleCentre", () => {
  const insets = (partial: Partial<typeof NO_INSETS>) => ({ ...NO_INSETS, ...partial });

  it("is the viewport centre when nothing is covering the map", () => {
    expect(visibleCentre(1440, 900, NO_INSETS)).toEqual([720, 450]);
  });

  it("shifts away from the covered edges, by half of what they claim", () => {
    // 468px of the right edge gone → the visible strip is 0…972, centred at 486.
    expect(visibleCentre(1440, 900, insets({ right: 468 }))).toEqual([486, 450]);
    // The top and bottom bands are unequal, so the centre moves up by 7px.
    expect(visibleCentre(1440, 900, insets({ top: 72, bottom: 86 }))).toEqual([720, 443]);
  });

  it("gives up when the chrome leaves too thin a strip to aim into", () => {
    expect(visibleCentre(1440, 900, insets({ right: 1441 - MIN_VISIBLE }))).toBeNull();
    expect(visibleCentre(1440, 900, insets({ top: 400, bottom: 400 }))).toBeNull();
  });

  it("gives up before the viewport has a size", () => {
    expect(visibleCentre(0, 0, NO_INSETS)).toBeNull();
  });
});

describe("fitPadding", () => {
  it("adds the base air to each side's own band", () => {
    expect(fitPadding(1440, 900, { top: 72, right: 468, bottom: 86, left: 0 }, 40)).toEqual({
      top: 112,
      right: 508,
      bottom: 126,
      left: 40,
    });
  });

  it("falls back to flat padding on the same guard as visibleCentre", () => {
    expect(fitPadding(1440, 900, { top: 400, right: 0, bottom: 400, left: 0 }, 40)).toEqual({
      top: 40,
      right: 40,
      bottom: 40,
      left: 40,
    });
  });
});
