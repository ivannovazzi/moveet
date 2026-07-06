import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { MapViewState } from "@deck.gl/core";
import { useDeckViewState } from "./useDeckViewState";
import { createRoadNetwork } from "@/test/mocks/types";

function renderViewState() {
  return renderHook(() => useDeckViewState({ data: createRoadNetwork(), width: 800, height: 600 }));
}

describe("useDeckViewState", () => {
  it("reports ready controls (the module stub reports not-ready until mount)", () => {
    const { result } = renderViewState();
    expect(result.current.controls.ready).toBe(true);
  });

  it("getZoom reflects the current zoom after onViewStateChange (no per-frame ref lag)", () => {
    const { result } = renderViewState();
    expect(result.current.controls.getZoom()).toBe(12);

    act(() => {
      result.current.onViewStateChange({
        viewState: { longitude: 36.82, latitude: -1.29, zoom: 15 } as MapViewState,
      });
    });

    expect(result.current.controls.getZoom()).toBe(15);
  });

  it("getZoom reflects a programmatic setZoom (ref stays in sync outside onViewStateChange)", () => {
    const { result } = renderViewState();

    act(() => {
      result.current.controls.setZoom(9);
    });

    expect(result.current.controls.getZoom()).toBe(9);
  });
});
