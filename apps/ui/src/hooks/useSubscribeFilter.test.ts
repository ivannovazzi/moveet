import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSubscribeFilter } from "./useSubscribeFilter";
import client from "@/utils/client";
import type { VehicleType } from "@/types";
import type { BoundingBox } from "@moveet/shared-types";

vi.mock("@/utils/client", () => ({
  default: {
    subscribe: vi.fn(),
  },
}));

vi.mock("@/components/Map/providers/contexts", () => ({
  MapContext: {
    _currentValue: {
      transform: null,
      getBoundingBox: () => [
        [0, 0],
        [0, 0],
      ],
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const fleets = [{ id: "fleet-a" }, { id: "fleet-b" }, { id: "fleet-c" }];

describe("useSubscribeFilter", () => {
  it("sends null when no filters are active", () => {
    renderHook(() => useSubscribeFilter(fleets, new Set(), new Set()));

    vi.advanceTimersByTime(200);
    expect(client.subscribe).toHaveBeenCalledWith(null);
  });

  it("sends fleetIds filter when fleets are hidden", () => {
    const hidden = new Set(["fleet-b"]);

    renderHook(() => useSubscribeFilter(fleets, hidden, new Set()));

    vi.advanceTimersByTime(200);
    expect(client.subscribe).toHaveBeenCalledWith({
      fleetIds: ["fleet-a", "fleet-c"],
    });
  });

  it("sends vehicleTypes filter when types are hidden", () => {
    const hiddenTypes = new Set<VehicleType>(["truck", "bus"]);

    renderHook(() => useSubscribeFilter(fleets, new Set(), hiddenTypes));

    vi.advanceTimersByTime(200);
    expect(client.subscribe).toHaveBeenCalledWith({
      vehicleTypes: ["car", "motorcycle", "ambulance"],
    });
  });

  it("sends combined filter when both fleet and type are hidden", () => {
    const hiddenFleets = new Set(["fleet-a"]);
    const hiddenTypes = new Set<VehicleType>(["ambulance"]);

    renderHook(() => useSubscribeFilter(fleets, hiddenFleets, hiddenTypes));

    vi.advanceTimersByTime(200);
    expect(client.subscribe).toHaveBeenCalledWith({
      fleetIds: ["fleet-b", "fleet-c"],
      vehicleTypes: ["car", "truck", "motorcycle", "bus"],
    });
  });

  it("debounces rapid changes", () => {
    const { rerender } = renderHook(
      ({ hidden }: { hidden: Set<string> }) => useSubscribeFilter(fleets, hidden, new Set()),
      { initialProps: { hidden: new Set<string>() } }
    );

    // Rapid changes before debounce fires
    rerender({ hidden: new Set(["fleet-a"]) });
    rerender({ hidden: new Set(["fleet-a", "fleet-b"]) });

    // Only the last one should fire
    vi.advanceTimersByTime(200);
    expect(client.subscribe).toHaveBeenCalledTimes(1);
    expect(client.subscribe).toHaveBeenCalledWith({
      fleetIds: ["fleet-c"],
    });
  });

  it("sends bbox filter when bbox is provided", () => {
    const bbox: BoundingBox = { minLat: -1.35, maxLat: -1.25, minLng: 36.75, maxLng: 36.85 };

    renderHook(() => useSubscribeFilter(fleets, new Set(), new Set(), bbox));

    vi.advanceTimersByTime(200);
    expect(client.subscribe).toHaveBeenCalledWith({ bbox });
  });

  it("sends null when bbox is null and no other filters", () => {
    renderHook(() => useSubscribeFilter(fleets, new Set(), new Set(), null));

    vi.advanceTimersByTime(200);
    expect(client.subscribe).toHaveBeenCalledWith(null);
  });

  it("sends combined filter with fleet, type, and bbox", () => {
    const hiddenFleets = new Set(["fleet-a"]);
    const hiddenTypes = new Set<VehicleType>(["bus"]);
    const bbox: BoundingBox = { minLat: -1.35, maxLat: -1.25, minLng: 36.75, maxLng: 36.85 };

    renderHook(() => useSubscribeFilter(fleets, hiddenFleets, hiddenTypes, bbox));

    vi.advanceTimersByTime(200);
    expect(client.subscribe).toHaveBeenCalledWith({
      fleetIds: ["fleet-b", "fleet-c"],
      vehicleTypes: ["car", "truck", "motorcycle", "ambulance"],
      bbox,
    });
  });

  it("re-sends when bbox changes", () => {
    const bbox1: BoundingBox = { minLat: -1.35, maxLat: -1.25, minLng: 36.75, maxLng: 36.85 };
    const bbox2: BoundingBox = { minLat: -1.3, maxLat: -1.2, minLng: 36.8, maxLng: 36.9 };

    const { rerender } = renderHook(
      ({ bbox }: { bbox: BoundingBox | null }) =>
        useSubscribeFilter(fleets, new Set(), new Set(), bbox),
      { initialProps: { bbox: bbox1 as BoundingBox | null } }
    );

    vi.advanceTimersByTime(200);
    expect(client.subscribe).toHaveBeenCalledWith({ bbox: bbox1 });

    vi.clearAllMocks();
    rerender({ bbox: bbox2 });

    vi.advanceTimersByTime(200);
    expect(client.subscribe).toHaveBeenCalledWith({ bbox: bbox2 });
  });

  it("omits bbox when not provided (backward compatible)", () => {
    const hiddenFleets = new Set(["fleet-a"]);

    renderHook(() => useSubscribeFilter(fleets, hiddenFleets, new Set()));

    vi.advanceTimersByTime(200);
    expect(client.subscribe).toHaveBeenCalledWith({
      fleetIds: ["fleet-b", "fleet-c"],
    });
  });
});
