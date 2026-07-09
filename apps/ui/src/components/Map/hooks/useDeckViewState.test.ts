import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { RoadNetwork } from "@/types";
import { useDeckViewState } from "./useDeckViewState";

// Default zoom when no network data is supplied (see DEFAULT_VIEW_STATE).
const DEFAULT_ZOOM = 12;

function setup() {
  return renderHook(() => useDeckViewState({ data: null, width: 800, height: 600 }));
}

/** A minimal road network spanning a small bbox so fitBounds has real extent. */
const NETWORK: RoadNetwork = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [36.6, -1.4],
          [37.0, -1.1],
        ],
      },
      properties: {},
    },
  ],
};

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

  it("clamps zoom-in to the view's max zoom", () => {
    const { result } = setup();
    // maxZoom is 20 → 8 presses from 12 would reach 20 and stop there.
    act(() => {
      for (let i = 0; i < 12; i++) result.current.controls.zoomIn();
    });
    expect(result.current.viewState.zoom).toBe(20);
  });

  it("floors the zoom-out at the fitted network extent so you can't zoom out into empty space", () => {
    const { result } = renderHook(() =>
      useDeckViewState({ data: NETWORK, width: 800, height: 600 })
    );

    // The fit-to-bounds effect sets zoom to the fitted level and minZoom one
    // level below it.
    const fittedZoom = result.current.viewState.zoom!;
    expect(result.current.viewState.minZoom).toBeCloseTo(fittedZoom - 1, 5);
    // The world-scale floor (1) is gone — the floor now sits near the city fit.
    expect(result.current.viewState.minZoom!).toBeGreaterThan(5);

    // Hammering zoom-out cannot go below that floor.
    act(() => {
      for (let i = 0; i < 30; i++) result.current.controls.zoomOut();
    });
    expect(result.current.viewState.zoom).toBeCloseTo(fittedZoom - 1, 5);
  });
});
