import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVehicles } from "./useVehicles";
import { createVehicleDTO } from "@/test/mocks/types";
import client from "@/utils/client";
import { vehicleStore } from "./vehicleStore";

vi.mock("@/utils/client", () => ({
  default: {
    onVehicle: vi.fn(),
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  // Reset the store between tests
  vehicleStore.replace([]);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Advance the throttle interval so React state syncs from the store. */
function flushStore() {
  vi.advanceTimersByTime(1100);
}

describe("useVehicles", () => {
  it("initializes with empty vehicles and default modifiers", () => {
    const { result } = renderHook(() => useVehicles());

    expect(result.current.vehicles).toEqual([]);
    expect(result.current.modifiers).toEqual({
      showDirections: true,
      showHeatzones: false,
      showHeatmap: false,
      showVehicles: true,
      showPOIs: false,
      showTrafficOverlay: true,
    });
  });

  it("setVehicles populates vehicle list with swapped lat/lng positions", () => {
    const { result } = renderHook(() => useVehicles());
    const dto = createVehicleDTO({ position: [-1.2921, 36.8219] });

    act(() => {
      result.current.setVehicles([dto]);
    });

    expect(result.current.vehicles).toHaveLength(1);
    expect(result.current.vehicles[0].position).toEqual([36.8219, -1.2921]);
  });

  it("vehicles get visible, selected, hovered flags based on filter state", () => {
    const { result } = renderHook(() => useVehicles());
    const v1 = createVehicleDTO({ id: "v1", name: "Alpha" });
    const v2 = createVehicleDTO({ id: "v2", name: "Beta" });

    act(() => {
      result.current.setVehicles([v1, v2]);
    });

    expect(result.current.vehicles[0].visible).toBe(true);
    expect(result.current.vehicles[1].visible).toBe(true);
    expect(result.current.vehicles[0].selected).toBe(false);
    expect(result.current.vehicles[0].hovered).toBe(false);

    act(() => {
      result.current.onSelectVehicle("v1");
    });
    expect(result.current.vehicles[0].selected).toBe(true);
    expect(result.current.vehicles[1].selected).toBe(false);

    act(() => {
      result.current.onHoverVehicle("v2");
    });
    expect(result.current.vehicles[1].hovered).toBe(true);
    expect(result.current.vehicles[0].hovered).toBe(false);
  });

  it("filters vehicles by name (case insensitive)", () => {
    const { result } = renderHook(() => useVehicles());
    const v1 = createVehicleDTO({ id: "v1", name: "Alpha Truck" });
    const v2 = createVehicleDTO({ id: "v2", name: "Beta Van" });

    act(() => {
      result.current.setVehicles([v1, v2]);
    });

    act(() => {
      result.current.onFilterChange("ALPHA");
    });

    expect(result.current.vehicles[0].visible).toBe(true);
    expect(result.current.vehicles[1].visible).toBe(false);

    act(() => {
      result.current.onFilterChange("beta");
    });

    expect(result.current.vehicles[0].visible).toBe(false);
    expect(result.current.vehicles[1].visible).toBe(true);
  });

  it("setModifiers updates modifier state", () => {
    const { result } = renderHook(() => useVehicles());

    act(() => {
      result.current.setModifiers((prev) => ({ ...prev, showPOIs: true, showHeatmap: true }));
    });

    expect(result.current.modifiers).toEqual({
      showDirections: true,
      showHeatzones: false,
      showHeatmap: true,
      showVehicles: true,
      showPOIs: true,
      showTrafficOverlay: true,
    });
  });
});

describe("useVehicleChanges (via client.onVehicle)", () => {
  it("receives vehicles from WebSocket via vehicleStore after throttle", () => {
    const { result } = renderHook(() => useVehicles());

    const onVehicleMock = vi.mocked(client.onVehicle);
    expect(onVehicleMock).toHaveBeenCalledOnce();

    const handler = onVehicleMock.mock.calls[0][0];
    const dto = createVehicleDTO({ id: "ws-1", name: "WS Vehicle" });

    act(() => {
      handler(dto);
      flushStore();
    });

    expect(result.current.vehicles).toHaveLength(1);
    expect(result.current.vehicles[0].id).toBe("ws-1");
    expect(result.current.vehicles[0].position).toEqual([36.8219, -1.2921]);
  });

  it("batches WS updates — React only sees the final state after throttle", () => {
    const { result } = renderHook(() => useVehicles());

    const handler = vi.mocked(client.onVehicle).mock.calls[0][0];
    const v1 = createVehicleDTO({ id: "v1", name: "First" });
    const v2 = createVehicleDTO({ id: "v2", name: "Second" });

    act(() => {
      handler(v1);
      handler(v2);
      flushStore();
    });

    expect(result.current.vehicles).toHaveLength(2);
  });

  it("deduplicates vehicles by id (last update wins)", () => {
    const { result } = renderHook(() => useVehicles());

    const handler = vi.mocked(client.onVehicle).mock.calls[0][0];
    const v1a = createVehicleDTO({ id: "v1", name: "Original", speed: 10 });
    const v1b = createVehicleDTO({ id: "v1", name: "Updated", speed: 99 });

    act(() => {
      handler(v1a);
      handler(v1b);
      flushStore();
    });

    expect(result.current.vehicles).toHaveLength(1);
    expect(result.current.vehicles[0].name).toBe("Updated");
    expect(result.current.vehicles[0].speed).toBe(99);
  });
});
