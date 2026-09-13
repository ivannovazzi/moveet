import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMapColorCache, resolveMapColor } from "./mapColor";

/**
 * jsdom has no 2D canvas, so `resolveMapColor` takes its no-canvas path and
 * every colour comes back as the documented grey fallback. That is exactly the
 * surface worth pinning here: what gets *cached* on the way to a fallback, and
 * whether a token that resolves later can still win.
 */
beforeEach(() => {
  resetMapColorCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetMapColorCache();
});

const FALLBACK: [number, number, number] = [128, 128, 128];

describe("resolveMapColor", () => {
  it("falls back to grey while keeping the caller's alpha", () => {
    expect(resolveMapColor("var(--color-heat-1)", 70)).toEqual([...FALLBACK, 70]);
    expect(resolveMapColor("var(--color-heat-1)")).toEqual([...FALLBACK, 255]);
  });

  it("does not cache a fallback, so a token that resolves later still wins", () => {
    const style = { getPropertyValue: vi.fn(() => "") };
    const spy = vi
      .spyOn(window, "getComputedStyle")
      .mockReturnValue(style as unknown as CSSStyleDeclaration);

    resolveMapColor("var(--color-late)");
    resolveMapColor("var(--color-late)");

    // Both calls went to the stylesheet: nothing was frozen in from the first.
    expect(style.getPropertyValue).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("looks the token up by name", () => {
    const style = { getPropertyValue: vi.fn(() => "  rgb(1, 2, 3)  ") };
    vi.spyOn(window, "getComputedStyle").mockReturnValue(style as unknown as CSSStyleDeclaration);

    resolveMapColor("var(--color-poi-shop)");

    expect(style.getPropertyValue).toHaveBeenCalledWith("--color-poi-shop");
  });
});
