import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDeckViewState } from "./useDeckViewState";

// Default zoom when no network data is supplied (see DEFAULT_VIEW_STATE).
const DEFAULT_ZOOM = 12;

function setup() {
  return renderHook(() => useDeckViewState({ data: null, width: 800, height: 600 }));
}

describe("useDeckViewState zoom controls", () => {
  it("zooms in by a full level per press and eases the transition", () => {
    const { result } = setup();
    act(() => result.current.controls.zoomIn());
    expect(result.current.viewState.zoom).toBe(DEFAULT_ZOOM + 1);
    expect(result.current.viewState.transitionDuration).toBe(200);
    expect(result.current.viewState.transitionInterpolator).toBeTruthy();
  });

  it("zooms out by a full level per press", () => {
    const { result } = setup();
    act(() => result.current.controls.zoomOut());
    expect(result.current.viewState.zoom).toBe(DEFAULT_ZOOM - 1);
  });

  it("accumulates across successive presses", () => {
    const { result } = setup();
    act(() => result.current.controls.zoomIn());
    act(() => result.current.controls.zoomIn());
    act(() => result.current.controls.zoomIn());
    expect(result.current.viewState.zoom).toBe(DEFAULT_ZOOM + 3);
  });

  it("clamps to the view's min/max zoom", () => {
    const { result } = setup();
    // maxZoom is 20 → 8 presses from 12 would reach 20 and stop there.
    act(() => {
      for (let i = 0; i < 12; i++) result.current.controls.zoomIn();
    });
    expect(result.current.viewState.zoom).toBe(20);

    act(() => {
      for (let i = 0; i < 40; i++) result.current.controls.zoomOut();
    });
    expect(result.current.viewState.zoom).toBe(1);
  });
});
