import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { Position } from "@/types";

// ---------------------------------------------------------------------------
// vi.hoisted — variables that vi.mock factories can reference
// ---------------------------------------------------------------------------
const { densityFn, mockSelect } = vi.hoisted(() => {
  const densityFn = vi.fn().mockReturnValue([]);

  const mockAttr = vi.fn().mockReturnThis();
  const mockMerge = vi.fn(() => ({ attr: mockAttr }));
  const mockAppend = vi.fn(() => ({ merge: mockMerge }));
  const mockEnter = vi.fn(() => ({ append: mockAppend }));
  const mockExit = vi.fn(() => ({ remove: vi.fn() }));
  const mockData = vi.fn(() => ({ exit: mockExit, enter: mockEnter }));
  const mockSelectAll = vi.fn(() => ({ data: mockData }));
  const mockSelect = vi.fn(() => ({ selectAll: mockSelectAll }));

  return { densityFn, mockSelect };
});

// ---------------------------------------------------------------------------
// Mock D3 and MapContext
// ---------------------------------------------------------------------------
vi.mock("d3", () => ({
  contourDensity: () => {
    const builder: Record<string, unknown> = {};
    builder.x = () => builder;
    builder.y = () => builder;
    builder.bandwidth = () => builder;
    builder.thresholds = () => builder;
    builder.size = () => densityFn;
    return builder;
  },
  scaleSequential: () => {
    const fn = (() => "#000") as Record<string, unknown> & (() => string);
    fn.domain = () => fn;
    fn.interpolator = () => fn;
    return fn;
  },
  interpolateRgb: () => () => "#000",
  max: () => 1,
  select: mockSelect,
  geoPath: () => () => "",
}));

vi.mock("@/components/Map/hooks", () => ({
  useMapContext: () => ({
    projection: (pos: Position) => pos,
    transform: { k: 1 },
  }),
}));

import HeatLayer from "@/components/Map/components/HeatLayer";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.useFakeTimers();
  densityFn.mockClear();
  mockSelect.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("HeatLayer debounce", () => {
  it("debounces density calculation — rapid updates trigger only one computation", () => {
    const data1: Position[] = [[36.82, -1.29]];
    const data2: Position[] = [[36.83, -1.3]];
    const data3: Position[] = [[36.84, -1.31]];

    const { rerender } = render(
      <svg>
        <HeatLayer data={data1} />
      </svg>
    );

    // Rapid updates before debounce fires
    rerender(
      <svg>
        <HeatLayer data={data2} />
      </svg>
    );
    rerender(
      <svg>
        <HeatLayer data={data3} />
      </svg>
    );

    // Before debounce period — no calculation yet
    expect(densityFn).not.toHaveBeenCalled();

    // Advance past default debounce (800ms)
    vi.advanceTimersByTime(800);

    // Only one call after debounce
    expect(densityFn).toHaveBeenCalledTimes(1);
  });

  it("uses custom debounceMs value", () => {
    const data: Position[] = [[36.82, -1.29]];

    render(
      <svg>
        <HeatLayer data={data} debounceMs={300} />
      </svg>
    );

    expect(densityFn).not.toHaveBeenCalled();

    // Not yet at 300ms
    vi.advanceTimersByTime(200);
    expect(densityFn).not.toHaveBeenCalled();

    // Now past 300ms
    vi.advanceTimersByTime(100);
    expect(densityFn).toHaveBeenCalledTimes(1);
  });

  it("cleans up timer on unmount — no errors", () => {
    const data: Position[] = [[36.82, -1.29]];

    const { unmount } = render(
      <svg>
        <HeatLayer data={data} />
      </svg>
    );

    // Unmount before debounce fires
    unmount();

    // Advancing timers after unmount should not cause errors
    vi.advanceTimersByTime(1000);

    // The density function should never have been called
    expect(densityFn).not.toHaveBeenCalled();
  });

  it("does not run calculation for empty data", () => {
    render(
      <svg>
        <HeatLayer data={[]} />
      </svg>
    );

    vi.advanceTimersByTime(1000);

    expect(densityFn).not.toHaveBeenCalled();
  });
});
