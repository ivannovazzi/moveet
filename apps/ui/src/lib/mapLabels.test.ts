import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  declutter,
  estimateLabelSize,
  type LabelBox,
  type LabelItem,
  LABEL_PRIORITY,
  labelFontFamily,
  mapLabelProps,
  resetLabelFontFamily,
  useVisibleLabels,
} from "./mapLabels";

function box(id: string, x: number, y: number, priority: number): LabelBox {
  return { id, x, y, w: 40, h: 14, priority };
}

/** Projects [lng, lat] straight through as pixels, so tests place boxes by hand. */
const identityViewport = { project: (lngLat: number[]) => [lngLat[0], lngLat[1]] };

/** Same projection, but with a canvas size so the off-screen cull engages. */
const sizedViewport = { ...identityViewport, width: 800, height: 600 };

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
    expect(props.fontSettings.fontSize).toBe(64);
  });

  it("names a concrete font family, never the CSS keyword", () => {
    // deck.gl rasterises the atlas with `ctx.font = "600 64px <fontFamily>"`.
    // A canvas silently ignores an invalid shorthand and keeps its 10px
    // default, which rendered every map label as a ~2px dash.
    resetLabelFontFamily();
    const { fontFamily } = mapLabelProps();
    expect(typeof fontFamily).toBe("string");
    expect(fontFamily.length).toBeGreaterThan(0);
    expect(fontFamily).not.toBe("inherit");
    expect(fontFamily).not.toMatch(/\b(inherit|initial|unset|revert)\b/);
  });

  it("falls back to a concrete stack when the document resolves nothing usable", () => {
    // jsdom answers "depends on user agent", which would reach the canvas as a
    // family name of that literal text.
    resetLabelFontFamily();
    const original = document.body.style.fontFamily;
    document.body.style.fontFamily = "";
    expect(labelFontFamily()).toMatch(/sans-serif/);
    resetLabelFontFamily();
    document.body.style.fontFamily = original;
  });

  it("prefers the family the document actually resolves", () => {
    resetLabelFontFamily();
    const original = document.body.style.fontFamily;
    document.body.style.fontFamily = "Inter, sans-serif";
    expect(labelFontFamily()).toContain("Inter");
    resetLabelFontFamily();
    document.body.style.fontFamily = original;
  });

  it("caches the resolved family across calls", () => {
    resetLabelFontFamily();
    const first = labelFontFamily();
    const original = document.body.style.fontFamily;
    document.body.style.fontFamily = "Comic Sans MS";
    expect(labelFontFamily()).toBe(first);
    resetLabelFontFamily();
    document.body.style.fontFamily = original;
  });

  it("covers ASCII plus the punctuation that shows up in place names", () => {
    const set = new Set(mapLabelProps().characterSet);
    for (const char of "ABCabc123 &'-/()") expect(set.has(char)).toBe(true);
    for (const char of "\u2019\u2013\u2026\u00b0") expect(set.has(char)).toBe(true);
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

  it("culls off-screen candidates instead of decluttering the whole city", () => {
    // At street zoom the POI layer offers thousands of candidates and only a
    // few dozen are on the canvas. The pass has to pay for the visible ones.
    const onScreen = 50;
    const items: LabelItem[] = [];
    for (let i = 0; i < onScreen; i++) {
      items.push(item(`near-${i}`, 20 + (i % 10) * 70, 20 + Math.floor(i / 10) * 100, 10));
    }
    for (let i = 0; i < 4950; i++) {
      // Well outside 800x600 + the 64px margin, in every direction.
      items.push(item(`far-${i}`, 5000 + i, 5000 + i, 10));
    }

    const started = performance.now();
    const { result, unmount } = renderHook(() =>
      useVisibleLabels("bulk", items, sizedViewport, 16)
    );
    const elapsed = performance.now() - started;

    expect(result.current.size).toBeGreaterThan(0);
    expect(result.current.size).toBeLessThanOrEqual(onScreen);
    for (const id of result.current) expect(id.startsWith("near-")).toBe(true);
    expect(elapsed).toBeLessThan(50);
    unmount();
  });

  it("settles when the caller rebuilds its items array every render", () => {
    // The natural way to call this is with an inline array, which is a fresh
    // reference each render. If the store republished on every registration,
    // subscribing would wake the caller, which would rebuild the array, which
    // would republish — a render loop. It has to converge instead.
    let renders = 0;
    const { result, unmount } = renderHook(() => {
      renders++;
      return useVisibleLabels(
        "inline",
        [item("inline-a", 10, 10, 10), item("inline-b", 400, 400, 10)],
        identityViewport,
        12
      );
    });

    expect(renders).toBeLessThanOrEqual(3);
    expect(result.current).toEqual(new Set(["inline-a", "inline-b"]));
    unmount();
  });
});
