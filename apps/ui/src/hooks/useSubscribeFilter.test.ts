import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSubscribeFilter } from "./useSubscribeFilter";
import client from "@/utils/client";
import type { VehicleType } from "@/types";

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
});
