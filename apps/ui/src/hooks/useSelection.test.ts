import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useSelection, selectionIdFor } from "./useSelection";
import type { POI, Road } from "@/types";

const road: Road = { name: "Moi Avenue", nodeIds: new Set(["n1"]), streets: [[[36.8, -1.28]]] };
const poi: POI = { id: "poi-1", name: "Cafe", coordinates: [-1.29, 36.82], type: "cafe" };

describe("useSelection", () => {
  it("starts with no selection", () => {
    const { result } = renderHook(() => useSelection());
    expect(result.current.selection).toBeNull();
    expect(result.current.selectedItem).toBeNull();
  });

  it("select() sets a vehicle selection", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.select("vehicle", "v1"));
    expect(result.current.selection).toEqual({ kind: "vehicle", id: "v1" });
    expect(result.current.selectedItem).toBeNull();
  });

  it("select() toggles off on the same kind+id", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.select("vehicle", "v1"));
    act(() => result.current.select("vehicle", "v1"));
    expect(result.current.selection).toBeNull();
  });

  it("select() replaces a different id of the same kind", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.select("vehicle", "v1"));
    act(() => result.current.select("vehicle", "v2"));
    expect(result.current.selection).toEqual({ kind: "vehicle", id: "v2" });
  });

  it("selecting any kind replaces a selection of another kind (mutual exclusion)", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.selectItem(poi));
    expect(result.current.selection).toEqual({ kind: "poi", id: "poi-1" });

    act(() => result.current.select("vehicle", "v1"));
    expect(result.current.selection).toEqual({ kind: "vehicle", id: "v1" });
    // The POI payload is gone — only one thing can be selected at a time.
    expect(result.current.selectedItem).toBeNull();
  });

  it("same id under a different kind is a new selection, not a toggle", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.select("vehicle", "x"));
    act(() => result.current.select("poi", "x"));
    expect(result.current.selection).toEqual({ kind: "poi", id: "x" });
  });

  it("selectItem() stores the road/POI object payload", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.selectItem(road));
    expect(result.current.selection).toEqual({ kind: "road", id: "Moi Avenue" });
    expect(result.current.selectedItem).toBe(road);

    act(() => result.current.selectItem(poi));
    expect(result.current.selection).toEqual({ kind: "poi", id: "poi-1" });
    expect(result.current.selectedItem).toBe(poi);
  });

  it("selectItem() re-selecting the same item keeps it selected (no toggle)", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.selectItem(poi));
    act(() => result.current.selectItem(poi));
    expect(result.current.selection).toEqual({ kind: "poi", id: "poi-1" });
    expect(result.current.selectedItem).toBe(poi);
  });

  it("clear() removes any selection", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.select("vehicle", "v1"));
    act(() => result.current.clear());
    expect(result.current.selection).toBeNull();

    act(() => result.current.selectItem(road));
    act(() => result.current.clear());
    expect(result.current.selection).toBeNull();
    expect(result.current.selectedItem).toBeNull();
  });

  it("setters are referentially stable across state changes", () => {
    const { result } = renderHook(() => useSelection());
    const { select, selectItem, clear } = result.current;
    act(() => result.current.select("vehicle", "v1"));
    expect(result.current.select).toBe(select);
    expect(result.current.selectItem).toBe(selectItem);
    expect(result.current.clear).toBe(clear);
  });
});

describe("selectionIdFor", () => {
  it("uses the road name as the road id", () => {
    expect(selectionIdFor(road)).toBe("Moi Avenue");
  });

  it("uses the POI id", () => {
    expect(selectionIdFor(poi)).toBe("poi-1");
  });
});
