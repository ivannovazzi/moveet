import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useFilters } from "./useVehicles";

describe("useFilters", () => {
  it("initializes with empty filter state", () => {
    const { result } = renderHook(() => useFilters());
    expect(result.current.filters).toEqual({
      filter: "",
      visible: [],
      selected: undefined,
      hovered: undefined,
    });
  });

  it("selects a vehicle", () => {
    const { result } = renderHook(() => useFilters());
    act(() => result.current.onSelectVehicle("v1"));
    expect(result.current.filters.selected).toBe("v1");
  });

  it("toggles selection on same vehicle", () => {
    const { result } = renderHook(() => useFilters());
    act(() => result.current.onSelectVehicle("v1"));
    expect(result.current.filters.selected).toBe("v1");
    act(() => result.current.onSelectVehicle("v1"));
    expect(result.current.filters.selected).toBeUndefined();
  });

  it("switches selection to a different vehicle", () => {
    const { result } = renderHook(() => useFilters());
    act(() => result.current.onSelectVehicle("v1"));
    expect(result.current.filters.selected).toBe("v1");
    act(() => result.current.onSelectVehicle("v2"));
    expect(result.current.filters.selected).toBe("v2");
  });

  it("unselects vehicle", () => {
    const { result } = renderHook(() => useFilters());
    act(() => result.current.onSelectVehicle("v1"));
    act(() => result.current.onUnselectVehicle());
    expect(result.current.filters.selected).toBeUndefined();
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

  it("preserves other state when selecting", () => {
    const { result } = renderHook(() => useFilters());
    act(() => result.current.onFilterChange("truck"));
    act(() => result.current.onHoverVehicle("v2"));
    act(() => result.current.onSelectVehicle("v1"));
    expect(result.current.filters).toEqual({
      filter: "truck",
      visible: [],
      selected: "v1",
      hovered: "v2",
    });
  });
});
