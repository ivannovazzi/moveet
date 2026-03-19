import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVehicleTypeFilter } from "./useVehicleTypeFilter";

describe("useVehicleTypeFilter", () => {
  it("initializes with empty hidden set", () => {
    const { result } = renderHook(() => useVehicleTypeFilter());
    expect(result.current.hiddenVehicleTypes).toEqual(new Set());
  });

  it("toggles a type on and off", () => {
    const { result } = renderHook(() => useVehicleTypeFilter());

    act(() => {
      result.current.toggleVehicleType("truck");
    });
    expect(result.current.hiddenVehicleTypes.has("truck")).toBe(true);

    act(() => {
      result.current.toggleVehicleType("truck");
    });
    expect(result.current.hiddenVehicleTypes.has("truck")).toBe(false);
  });

  it("tracks multiple hidden types independently", () => {
    const { result } = renderHook(() => useVehicleTypeFilter());

    act(() => {
      result.current.toggleVehicleType("truck");
      result.current.toggleVehicleType("bus");
    });

    expect(result.current.hiddenVehicleTypes.has("truck")).toBe(true);
    expect(result.current.hiddenVehicleTypes.has("bus")).toBe(true);
    expect(result.current.hiddenVehicleTypes.has("car")).toBe(false);

    act(() => {
      result.current.toggleVehicleType("truck");
    });

    expect(result.current.hiddenVehicleTypes.has("truck")).toBe(false);
    expect(result.current.hiddenVehicleTypes.has("bus")).toBe(true);
  });
});
