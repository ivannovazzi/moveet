import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  declutter,
  estimateLabelSize,
  type LabelBox,
  type LabelItem,
  LABEL_PRIORITY,
  mapLabelProps,
  useVisibleLabels,
} from "./mapLabels";

function box(id: string, x: number, y: number, priority: number): LabelBox {
  return { id, x, y, w: 40, h: 14, priority };
}

/** Projects [lng, lat] straight through as pixels, so tests place boxes by hand. */
const identityViewport = { project: (lngLat: number[]) => [lngLat[0], lngLat[1]] };

function item(id: string, x: number, y: number, priority: number): LabelItem {
  return { id, position: [x, y], text: "abcdef", size: 12, priority };
}

describe("mapLabelProps", () => {
  it("asks for an SDF atlas large enough for the halo it requests", () => {
    const props = mapLabelProps(12);
    expect(props.fontSettings.sdf).toBe(true);
    expect(props.fontSettings.radius).toBeGreaterThanOrEqual(props.outlineWidth);
    expect(props.fontSettings.buffer).toBeGreaterThanOrEqual(0.75 * props.outlineWidth);
    expect(props.getSize).toBe(12);
    expect(props.sizeUnits).toBe("pixels");
  });
});

describe("declutter", () => {
  it("drops the lower-priority label of an overlapping pair", () => {
    const visible = declutter([
      box("poi", 100, 100, LABEL_PRIORITY.poi),
      box("road", 104, 102, LABEL_PRIORITY.selectedRoad),
    ]);
    expect([...visible]).toEqual(["road"]);
  });

  it("keeps both when they do not overlap", () => {
    const visible = declutter([box("a", 0, 0, 10), box("b", 500, 500, 10)]);
    expect(visible).toEqual(new Set(["a", "b"]));
  });

  it("breaks ties on id, deterministically and regardless of input order", () => {
    const a = box("aaa", 10, 10, 50);
    const b = box("bbb", 12, 11, 50);
    expect([...declutter([a, b])]).toEqual(["aaa"]);
    expect([...declutter([b, a])]).toEqual(["aaa"]);
  });
});

describe("estimateLabelSize", () => {
  it("grows with both the text length and the font size", () => {
    expect(estimateLabelSize("abcd", 10)).toEqual({ w: 4 * 10 * 0.58, h: 13 });
    expect(estimateLabelSize("ab", 10).w).toBeLessThan(estimateLabelSize("abcd", 10).w);
  });
});

describe("useVisibleLabels", () => {
  it("returns everything when there is no viewport to project through", () => {
    const items = [item("a", 0, 0, 10), item("b", 0, 0, 10)];
    const { result } = renderHook(() => useVisibleLabels("solo", items, null, 12));
    expect(result.current).toEqual(new Set(["a", "b"]));
  });

  it("declutters across layers, not only within one", () => {
    // Two layers, one label each, landing on the same pixel: only the
    // higher-priority one survives, and each hook sees the shared verdict.
    const jobItems = [item("job-1", 200, 200, LABEL_PRIORITY.job)];
    const poiItems = [item("poi-1", 202, 201, LABEL_PRIORITY.poi)];

    const jobs = renderHook(() => useVisibleLabels("jobs", jobItems, identityViewport, 14));
    const pois = renderHook(() => useVisibleLabels("pois", poiItems, identityViewport, 14));
    jobs.rerender();

    expect(jobs.result.current).toEqual(new Set(["job-1"]));
    expect(pois.result.current).toEqual(new Set());

    // Once the winning layer unmounts, the loser is free to show again.
    jobs.unmount();
    pois.rerender();
    expect(pois.result.current).toEqual(new Set(["poi-1"]));
    pois.unmount();
  });
});
