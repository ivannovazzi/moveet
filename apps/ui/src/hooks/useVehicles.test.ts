import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVehicles } from "./useVehicles";
import { createVehicleDTO } from "@/test/mocks/types";
import client from "@/utils/client";

vi.mock("@/utils/client", () => ({
  default: {
    onVehicle: vi.fn(),
  },
}));

let pendingRafCallbacks: FrameRequestCallback[] = [];
let rafCounter = 0;

vi.stubGlobal(
  "requestAnimationFrame",
  vi.fn((cb: FrameRequestCallback) => {
    pendingRafCallbacks.push(cb);
    return ++rafCounter;
  })
);
vi.stubGlobal("cancelAnimationFrame", vi.fn());

function flushRaf() {
  const cbs = pendingRafCallbacks;
  pendingRafCallbacks = [];
  cbs.forEach((cb) => cb(0));
}

beforeEach(() => {
  vi.clearAllMocks();
  pendingRafCallbacks = [];
  rafCounter = 0;
});

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

    // All visible by default (no visible filter, no text filter)
    expect(result.current.vehicles[0].visible).toBe(true);
    expect(result.current.vehicles[1].visible).toBe(true);
    expect(result.current.vehicles[0].selected).toBe(false);
    expect(result.current.vehicles[0].hovered).toBe(false);

    // Select v1
    act(() => {
      result.current.onSelectVehicle("v1");
    });
    expect(result.current.vehicles[0].selected).toBe(true);
    expect(result.current.vehicles[1].selected).toBe(false);

    // Hover v2
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

    // Lowercase also works
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
    });
  });
});

describe("useVehicleChanges (via client.onVehicle)", () => {
  it("receives vehicles from WebSocket via client.onVehicle callback", () => {
    const { result } = renderHook(() => useVehicles());

    const onVehicleMock = vi.mocked(client.onVehicle);
    expect(onVehicleMock).toHaveBeenCalledOnce();

    const handler = onVehicleMock.mock.calls[0][0];
    const dto = createVehicleDTO({ id: "ws-1", name: "WS Vehicle" });

    act(() => {
      handler(dto);
      flushRaf();
    });

    expect(result.current.vehicles).toHaveLength(1);
    expect(result.current.vehicles[0].id).toBe("ws-1");
    expect(result.current.vehicles[0].position).toEqual([36.8219, -1.2921]);
  });

  it("batches multiple onVehicle calls into a single rAF flush", () => {
    const { result } = renderHook(() => useVehicles());

    const handler = vi.mocked(client.onVehicle).mock.calls[0][0];
    const v1 = createVehicleDTO({ id: "v1", name: "First" });
    const v2 = createVehicleDTO({ id: "v2", name: "Second" });

    // Both handler calls happen before rAF fires
    act(() => {
      handler(v1);
      handler(v2);
    });

    // rAF was only requested once (batching)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    // Flush the pending rAF to trigger the state update
    act(() => {
      flushRaf();
    });

    // Both vehicles should be present after a single rAF flush
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
    });

    act(() => {
      flushRaf();
    });

    expect(result.current.vehicles).toHaveLength(1);
    expect(result.current.vehicles[0].name).toBe("Updated");
    expect(result.current.vehicles[0].speed).toBe(99);
  });
});
