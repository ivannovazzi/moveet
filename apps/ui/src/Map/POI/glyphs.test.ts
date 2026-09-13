import { describe, it, expect } from "vitest";
import { POI_GROUPS } from "./categories";
import { SUPPORTED_GLYPH_TAGS } from "./iconAtlas";
import { POI_GLYPHS } from "./glyphs";

/** Attributes the rasteriser reads, per tag. */
const REQUIRED_ATTRS: Record<string, string[]> = {
  path: ["d"],
  circle: ["cx", "cy", "r"],
  rect: ["x", "y", "width", "height"],
  line: ["x1", "y1", "x2", "y2"],
  polyline: ["points"],
  polygon: ["points"],
};

/** Everything an element may legally carry: the required set plus the rounded-rect
 *  radii `strokeElement` draws through `ctx.roundRect`. */
const ALLOWED_ATTRS: Record<string, string[]> = {
  ...REQUIRED_ATTRS,
  rect: [...REQUIRED_ATTRS.rect, "rx", "ry"],
};

describe("POI_GLYPHS", () => {
  it("gives every group something to draw", () => {
    for (const group of POI_GROUPS) {
      expect(POI_GLYPHS[group], group).toBeDefined();
      expect(POI_GLYPHS[group].length, group).toBeGreaterThan(0);
    }
  });

  it("only uses element tags the rasteriser handles", () => {
    // A lucide refresh that introduced, say, an `ellipse` would otherwise drop
    // that stroke silently and leave a subtly wrong icon on the map.
    for (const group of POI_GROUPS) {
      for (const [tag] of POI_GLYPHS[group]) {
        expect(SUPPORTED_GLYPH_TAGS, `${group}: ${tag}`).toContain(tag);
      }
    }
  });

  it("gives every element the attributes its tag is drawn from", () => {
    for (const group of POI_GROUPS) {
      for (const [tag, attrs] of POI_GLYPHS[group]) {
        for (const attr of REQUIRED_ATTRS[tag]) {
          expect(attrs[attr], `${group}: ${tag}.${attr}`).toBeDefined();
        }
      }
    }
  });

  it("carries no attribute the rasteriser would silently ignore", () => {
    // A `transform`, a `fill-rule`: anything the draw path does not read changes
    // the shape in lucide's SVG but not on our canvas, so it has to fail here
    // rather than ship a subtly different icon.
    for (const group of POI_GROUPS) {
      for (const [tag, attrs] of POI_GLYPHS[group]) {
        for (const attr of Object.keys(attrs)) {
          expect(ALLOWED_ATTRS[tag], `${group}: ${tag}.${attr}`).toContain(attr);
        }
      }
    }
  });
});
