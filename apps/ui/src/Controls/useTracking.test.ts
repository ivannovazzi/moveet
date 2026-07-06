import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import useTracking, { MIN_FOCUS_ZOOM } from "./useTracking";
import { useMapControls } from "@/components/Map/hooks";
import { createVehicle } from "@/test/mocks/types";
import type { Vehicle } from "@/types";

vi.mock("@/components/Map/hooks", () => ({
  useMapControls: vi.fn(),
}));

const focusOn = vi.fn();
const getZoom = vi.fn();

function mockControls(ready = true) {
  vi.mocked(useMapControls).mockReturnValue({
    ready,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    panTo: vi.fn(),
    setZoom: vi.fn(),
    getZoom,
    setBounds: vi.fn(),
    focusOn,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getZoom.mockReturnValue(12);
  mockControls(true);
});

function renderTracking(vehicles: Vehicle[], selected: string | undefined) {
  return renderHook(
    ({ vehicles, selected }: { vehicles: Vehicle[]; selected: string | undefined }) =>
      useTracking(vehicles, selected),
    { initialProps: { vehicles, selected } }
  );
}

describe("useTracking", () => {
  it("flies once on selection, flooring the current zoom to MIN_FOCUS_ZOOM", () => {
    const vehicle = createVehicle({ id: "v1", position: [36.82, -1.29] });
    getZoom.mockReturnValue(10);

    renderTracking([vehicle], "v1");

    expect(focusOn).toHaveBeenCalledTimes(1);
    expect(focusOn).toHaveBeenCalledWith(36.82, -1.29, MIN_FOCUS_ZOOM, { duration: 0 });
  });

  it("keeps the user's zoom when already zoomed in past the floor", () => {
    const vehicle = createVehicle({ id: "v1", position: [36.82, -1.29] });
    getZoom.mockReturnValue(16.5);

    renderTracking([vehicle], "v1");

    expect(focusOn).toHaveBeenCalledWith(36.82, -1.29, 16.5, { duration: 0 });
  });

  it("does NOT call focusOn when no vehicle is selected", () => {
    const vehicle = createVehicle({ id: "v1" });

    renderTracking([vehicle], undefined);

    expect(focusOn).not.toHaveBeenCalled();
  });

  it("does NOT re-fly on position ticks while the same vehicle stays selected", () => {
    const vehicle = createVehicle({ id: "v1", position: [36.82, -1.29] });
    const { rerender } = renderTracking([vehicle], "v1");
    expect(focusOn).toHaveBeenCalledTimes(1);

    const moved = createVehicle({ id: "v1", position: [36.83, -1.3] });
    rerender({ vehicles: [moved], selected: "v1" });
    rerender({ vehicles: [createVehicle({ id: "v1", position: [36.84, -1.31] })], selected: "v1" });

    expect(focusOn).toHaveBeenCalledTimes(1);
  });

  it("re-flies when a different vehicle is selected", () => {
    const v1 = createVehicle({ id: "v1", position: [36.82, -1.29] });
    const v2 = createVehicle({ id: "v2", position: [36.9, -1.35] });
    const { rerender } = renderTracking([v1, v2], "v1");
    expect(focusOn).toHaveBeenCalledTimes(1);

    rerender({ vehicles: [v1, v2], selected: "v2" });

    expect(focusOn).toHaveBeenCalledTimes(2);
    expect(focusOn).toHaveBeenLastCalledWith(36.9, -1.35, MIN_FOCUS_ZOOM, { duration: 0 });
  });

  it("re-flies when the same vehicle is re-selected after deselection", () => {
    const vehicle = createVehicle({ id: "v1", position: [36.82, -1.29] });
    const { rerender } = renderTracking([vehicle], "v1");
    expect(focusOn).toHaveBeenCalledTimes(1);

    rerender({ vehicles: [vehicle], selected: undefined });
    rerender({ vehicles: [vehicle], selected: "v1" });

    expect(focusOn).toHaveBeenCalledTimes(2);
  });

  it("defers the fly-to while controls are not ready, then flies once they are", () => {
    // A vehicle is selected before the lazy map (and its real controls) mounts.
    mockControls(false);
    const vehicle = createVehicle({ id: "v1", position: [36.82, -1.29] });
    const { rerender } = renderTracking([vehicle], "v1");

    // Not ready → the one-shot must NOT be consumed by the no-op stub.
    expect(focusOn).not.toHaveBeenCalled();

    // Controls mount; a subsequent render (e.g. a vehicle tick) now flies once.
    mockControls(true);
    rerender({ vehicles: [createVehicle({ id: "v1", position: [36.82, -1.29] })], selected: "v1" });

    expect(focusOn).toHaveBeenCalledTimes(1);
    expect(focusOn).toHaveBeenCalledWith(36.82, -1.29, MIN_FOCUS_ZOOM, { duration: 0 });
  });

  it("flies once the selected vehicle's position becomes available", () => {
    const { rerender } = renderTracking([], "v1");
    expect(focusOn).not.toHaveBeenCalled();

    const vehicle = createVehicle({ id: "v1", position: [36.82, -1.29] });
    rerender({ vehicles: [vehicle], selected: "v1" });

    expect(focusOn).toHaveBeenCalledTimes(1);
    expect(focusOn).toHaveBeenCalledWith(36.82, -1.29, MIN_FOCUS_ZOOM, { duration: 0 });
  });
});
