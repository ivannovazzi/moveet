import { afterEach, describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { WebMercatorViewport } from "@deck.gl/core";
import type { RoadNetwork } from "@/types";
import { useDeckViewState } from "./useDeckViewState";
import { resetInsets, setInset } from "../mapInsets";

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

describe("flying to a target the chrome is covering", () => {
  afterEach(() => resetInsets());

  it("centres on the target when nothing is covering the map", () => {
    const { result } = setup();
    act(() => result.current.controls.focusOn(36.82, -1.29, 15, { duration: 0 }));

    expect(result.current.viewState.longitude).toBeCloseTo(36.82, 6);
    expect(result.current.viewState.latitude).toBeCloseTo(-1.29, 6);
    expect(result.current.viewState.zoom).toBe(15);
  });

  it("offsets the camera so a panelled-over target still lands where you can see it", () => {
    const { result } = setup();
    // A 400px panel down the right edge of the 800px viewport: the target has
    // to sit at x=200, so the camera centre moves east of it.
    setInset("section-panel", { right: 400 });
    act(() => result.current.controls.focusOn(36.82, -1.29, 15, { duration: 0 }));

    const { longitude, latitude } = result.current.viewState;
    expect(longitude!).toBeGreaterThan(36.82);
    expect(latitude!).toBeCloseTo(-1.29, 6);

    // …and the target projects onto the visible half's centre line.
    const vp = new WebMercatorViewport({
      width: 800,
      height: 600,
      longitude: longitude!,
      latitude: latitude!,
      zoom: 15,
    });
    const [x, y] = vp.project([36.82, -1.29]);
    expect(x).toBeCloseTo(200, 3);
    expect(y).toBeCloseTo(300, 3);
  });

  it("centres plainly when the chrome leaves too little map to aim into", () => {
    const { result } = setup();
    setInset("everything", { right: 700 });
    act(() => result.current.controls.focusOn(36.82, -1.29, 15, { duration: 0 }));

    expect(result.current.viewState.longitude).toBeCloseTo(36.82, 6);
  });

  it("pans with the same offset, at the zoom the user is already on", () => {
    const { result } = setup();
    setInset("inspector", { right: 348 });
    act(() => result.current.controls.panTo(36.82, -1.29, { duration: 0 }));

    expect(result.current.viewState.longitude!).toBeGreaterThan(36.82);
    expect(result.current.viewState.zoom).toBe(DEFAULT_ZOOM);
  });

  it("fits a bounding box into the strip the chrome leaves, not the whole viewport", () => {
    const { result } = setup();
    act(() =>
      result.current.controls.setBounds([
        [36.7, -1.35],
        [36.9, -1.2],
      ])
    );
    const plain = { ...result.current.viewState };

    setInset("section-panel", { right: 400 });
    act(() =>
      result.current.controls.setBounds([
        [36.7, -1.35],
        [36.9, -1.2],
      ])
    );

    // Less room means a wider-out fit, and a centre pushed away from the panel.
    expect(result.current.viewState.zoom!).toBeLessThan(plain.zoom!);
    expect(result.current.viewState.longitude!).toBeGreaterThan(plain.longitude!);
  });
});
