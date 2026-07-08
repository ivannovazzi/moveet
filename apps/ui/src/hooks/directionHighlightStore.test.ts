import { describe, it, expect, beforeEach } from "vitest";
import {
  clearDirectionHighlight,
  sameStep,
  setHoveredStep,
  togglePinnedStep,
  useDirectionHighlight,
} from "./directionHighlightStore";
import { renderHook, act } from "@testing-library/react";

beforeEach(() => clearDirectionHighlight());

describe("sameStep", () => {
  it("matches on vehicleId + start, ignoring end, and rejects nulls", () => {
    expect(
      sameStep({ vehicleId: "v", start: 2, end: 5 }, { vehicleId: "v", start: 2, end: 9 })
    ).toBe(true);
    expect(
      sameStep({ vehicleId: "v", start: 2, end: 5 }, { vehicleId: "w", start: 2, end: 5 })
    ).toBe(false);
    expect(sameStep(null, { vehicleId: "v", start: 0, end: 1 })).toBe(false);
    expect(sameStep(null, null)).toBe(false);
  });
});

describe("directionHighlightStore", () => {
  it("tracks hovered and pinned independently and notifies subscribers", () => {
    const { result } = renderHook(() => useDirectionHighlight());
    expect(result.current).toEqual({ hovered: null, pinned: null });

    act(() => setHoveredStep({ vehicleId: "v1", start: 0, end: 3 }));
    expect(result.current.hovered).toEqual({ vehicleId: "v1", start: 0, end: 3 });
    expect(result.current.pinned).toBeNull();

    act(() => togglePinnedStep({ vehicleId: "v1", start: 5, end: 8 }));
    expect(result.current.pinned).toEqual({ vehicleId: "v1", start: 5, end: 8 });
    // Hover survives pinning.
    expect(result.current.hovered).toEqual({ vehicleId: "v1", start: 0, end: 3 });

    act(() => setHoveredStep(null));
    expect(result.current.hovered).toBeNull();
  });

  it("toggles the pinned step off when the same step is clicked again", () => {
    const { result } = renderHook(() => useDirectionHighlight());
    const step = { vehicleId: "v1", start: 2, end: 4 };

    act(() => togglePinnedStep(step));
    expect(result.current.pinned).toEqual(step);
    act(() => togglePinnedStep({ ...step, end: 99 })); // same step (start matches)
    expect(result.current.pinned).toBeNull();
  });

  it("clears both hovered and pinned", () => {
    const { result } = renderHook(() => useDirectionHighlight());
    act(() => {
      setHoveredStep({ vehicleId: "v1", start: 0, end: 1 });
      togglePinnedStep({ vehicleId: "v1", start: 2, end: 3 });
    });
    act(() => clearDirectionHighlight());
    expect(result.current).toEqual({ hovered: null, pinned: null });
  });
});
