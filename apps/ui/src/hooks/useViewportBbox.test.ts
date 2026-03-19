import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useViewportBbox } from "./useViewportBbox";

const mockGetBoundingBox = vi.fn(
  () =>
    [
      [36.75, -1.35],
      [36.85, -1.25],
    ] as [[number, number], [number, number]]
);

const mockTransform = { k: 5, x: 0, y: 0 };

vi.mock("@/components/Map/hooks", () => ({
  useMapContext: vi.fn(() => ({
    transform: mockTransform,
    getBoundingBox: mockGetBoundingBox,
  })),
}));

const { useMapContext } = await import("@/components/Map/hooks");
const mockedUseMapContext = vi.mocked(useMapContext);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useViewportBbox", () => {
  it("returns null initially before debounce fires", () => {
    const { result } = renderHook(() => useViewportBbox());
    expect(result.current).toBeNull();
  });

  it("returns bbox after debounce when zoom >= 3", () => {
    const { result } = renderHook(() => useViewportBbox());

    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(result.current).toEqual({
      minLat: -1.35,
      maxLat: -1.25,
      minLng: 36.75,
      maxLng: 36.85,
    });
  });

  it("returns null when zoom is below threshold", () => {
    mockedUseMapContext.mockReturnValue({
      transform: { k: 2, x: 0, y: 0 } as never,
      getBoundingBox: mockGetBoundingBox,
      map: null,
      projection: null,
      getZoom: () => 2,
    });

    const { result } = renderHook(() => useViewportBbox());

    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(result.current).toBeNull();
  });

  it("returns null when transform is null", () => {
    mockedUseMapContext.mockReturnValue({
      transform: null,
      getBoundingBox: mockGetBoundingBox,
      map: null,
      projection: null,
      getZoom: () => 0,
    });

    const { result } = renderHook(() => useViewportBbox());

    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(result.current).toBeNull();
  });

  it("debounces rapid transform changes", () => {
    const bbox1 = [
      [36.75, -1.35],
      [36.85, -1.25],
    ] as [[number, number], [number, number]];
    const bbox2 = [
      [36.8, -1.3],
      [36.9, -1.2],
    ] as [[number, number], [number, number]];

    const getBbox = vi.fn(() => bbox1);
    mockedUseMapContext.mockReturnValue({
      transform: { k: 5, x: 0, y: 0 } as never,
      getBoundingBox: getBbox,
      map: null,
      projection: null,
      getZoom: () => 5,
    });

    const { result, rerender } = renderHook(() => useViewportBbox());

    // Simulate rapid changes before debounce fires
    getBbox.mockReturnValue(bbox2);
    mockedUseMapContext.mockReturnValue({
      transform: { k: 5, x: 10, y: 10 } as never,
      getBoundingBox: getBbox,
      map: null,
      projection: null,
      getZoom: () => 5,
    });
    rerender();

    act(() => {
      vi.advanceTimersByTime(350);
    });

    // Should only have the last bbox value
    expect(result.current).toEqual({
      minLat: -1.3,
      maxLat: -1.2,
      minLng: 36.8,
      maxLng: 36.9,
    });
  });

  it("normalizes min/max correctly when coordinates are swapped", () => {
    // getBoundingBox may return topLeft/bottomRight with lat1 > lat2
    mockedUseMapContext.mockReturnValue({
      transform: { k: 5, x: 0, y: 0 } as never,
      getBoundingBox: () =>
        [
          [36.9, -1.2],
          [36.75, -1.35],
        ] as [[number, number], [number, number]],
      map: null,
      projection: null,
      getZoom: () => 5,
    });

    const { result } = renderHook(() => useViewportBbox());

    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(result.current).toEqual({
      minLat: -1.35,
      maxLat: -1.2,
      minLng: 36.75,
      maxLng: 36.9,
    });
  });
});
