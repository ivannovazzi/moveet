import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useFilters } from "./useVehicles";

describe("useFilters", () => {
  it("initializes with empty filter state", () => {
    const { result } = renderHook(() => useFilters());
    expect(result.current.filters).toEqual({
      filter: "",
      visible: [],
      hovered: undefined,
    });
  });

  it("does not manage vehicle selection (lives in useSelection)", () => {
    const { result } = renderHook(() => useFilters());
    expect(result.current.filters.selected).toBeUndefined();
    expect("onSelectVehicle" in result.current).toBe(false);
  });

  it("sets hover state", () => {
    const { result } = renderHook(() => useFilters());
    act(() => result.current.onHoverVehicle("v1"));
    expect(result.current.filters.hovered).toBe("v1");
  });

  it("clears hover state", () => {
    const { result } = renderHook(() => useFilters());
    act(() => result.current.onHoverVehicle("v1"));
    act(() => result.current.onUnhoverVehicle());
    expect(result.current.filters.hovered).toBeUndefined();
  });

  it("updates filter text", () => {
    const { result } = renderHook(() => useFilters());
    act(() => result.current.onFilterChange("truck"));
    expect(result.current.filters.filter).toBe("truck");
  });

  it("preserves other state when hovering", () => {
    const { result } = renderHook(() => useFilters());
    act(() => result.current.onFilterChange("truck"));
    act(() => result.current.onHoverVehicle("v2"));
    expect(result.current.filters).toEqual({
      filter: "truck",
      visible: [],
      hovered: "v2",
    });
  });
});
