import { describe, it, expect } from "vitest";
import type { RoadNetwork } from "@/types";
import {
  computeFeatureBounds,
  cullRoadFeatures,
  shouldRenderMinorRoads,
  LOD_MIN_ZOOM_FOR_MINOR_ROADS,
  CULL_MARGIN,
  type ViewportBox,
} from "./roadCulling";

type RoadFeature = RoadNetwork["features"][number];

function feature(
  id: string,
  coords: [number, number][],
  highway: string,
  type = "road"
): RoadFeature {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords },
    properties: { name: id, type, highway },
  };
}

// A 1x1 degree viewport centred on the origin.
const VIEWPORT: ViewportBox = [
  [0, 0],
  [1, 1],
];

// Features at known positions relative to VIEWPORT (margin = 25% → -0.25..1.25).
const inside = feature(
  "inside",
  [
    [0.4, 0.4],
    [0.6, 0.6],
  ],
  "primary"
);
const insideMinor = feature(
  "insideMinor",
  [
    [0.4, 0.4],
    [0.6, 0.6],
  ],
  "residential"
);
// Just outside the right edge but within the 25% margin (1.0 < x < 1.25).
const inMargin = feature(
  "inMargin",
  [
    [1.1, 0.5],
    [1.2, 0.5],
  ],
  "primary"
);
// Far to the right, well beyond the margin.
const farOutside = feature(
  "farOutside",
  [
    [5, 5],
    [6, 6],
  ],
  "primary"
);
const farOutsideMinor = feature(
  "farOutsideMinor",
  [
    [5, 5],
    [6, 6],
  ],
  "residential"
);

const ALL = [inside, insideMinor, inMargin, farOutside, farOutsideMinor];
const BOUNDS = computeFeatureBounds(ALL);

const HIGH_ZOOM = LOD_MIN_ZOOM_FOR_MINOR_ROADS + 1;
const LOW_ZOOM = LOD_MIN_ZOOM_FOR_MINOR_ROADS - 1;

function ids(features: RoadFeature[]): string[] {
  return features.map((f) => f.properties.name as string).sort();
}

describe("computeFeatureBounds", () => {
  it("computes index-aligned [minLng,minLat,maxLng,maxLat] per feature", () => {
    const bounds = computeFeatureBounds([
      feature(
        "a",
        [
          [2, 3],
          [-1, 8],
          [4, 0],
        ],
        "primary"
      ),
    ]);
    expect(bounds[0]).toEqual([-1, 0, 4, 8]);
  });

  it("returns an array index-aligned with the input", () => {
    expect(BOUNDS).toHaveLength(ALL.length);
  });
});

describe("shouldRenderMinorRoads", () => {
  it("is false below the LOD threshold and true at/above it", () => {
    expect(shouldRenderMinorRoads(LOW_ZOOM)).toBe(false);
    expect(shouldRenderMinorRoads(LOD_MIN_ZOOM_FOR_MINOR_ROADS)).toBe(true);
    expect(shouldRenderMinorRoads(HIGH_ZOOM)).toBe(true);
  });
});

describe("cullRoadFeatures", () => {
  it("keeps features intersecting the viewport plus margin, drops far-away ones", () => {
    const result = cullRoadFeatures(ALL, BOUNDS, VIEWPORT, HIGH_ZOOM);
    // inside, insideMinor (zoomed in → minor allowed), inMargin all kept;
    // both far-outside features dropped by bbox.
    expect(ids(result)).toEqual(["inMargin", "inside", "insideMinor"]);
  });

  it("includes features inside the margin band but outside the raw viewport", () => {
    const result = cullRoadFeatures(ALL, BOUNDS, VIEWPORT, HIGH_ZOOM);
    expect(ids(result)).toContain("inMargin");
  });

  it("drops minor road classes below the zoom LOD threshold", () => {
    const result = cullRoadFeatures(ALL, BOUNDS, VIEWPORT, LOW_ZOOM);
    // insideMinor is filtered out by LOD even though it is on-screen; the
    // major-class features within the viewport+margin remain.
    expect(ids(result)).toEqual(["inMargin", "inside"]);
  });

  it("never drops major classes regardless of zoom", () => {
    const result = cullRoadFeatures(ALL, BOUNDS, VIEWPORT, LOW_ZOOM);
    expect(ids(result)).toContain("inside");
    expect(ids(result)).toContain("inMargin");
  });

  it("disables bbox culling for a degenerate viewport (still applies LOD)", () => {
    const degenerate: ViewportBox = [
      [0, 0],
      [0, 0],
    ];
    // No bbox filtering → all features pass the (high zoom) LOD filter.
    const high = cullRoadFeatures(ALL, BOUNDS, degenerate, HIGH_ZOOM);
    expect(ids(high)).toEqual(ids(ALL));
    // At low zoom only the major classes survive, but none are bbox-culled.
    const low = cullRoadFeatures(ALL, BOUNDS, degenerate, LOW_ZOOM);
    expect(ids(low)).toEqual(["farOutside", "inMargin", "inside"]);
  });

  it("uses CULL_MARGIN as the default expansion factor", () => {
    // Sanity: a feature exactly at viewport edge + (CULL_MARGIN * span) is kept.
    const edge = feature("edge", [[1 + CULL_MARGIN, 0.5]], "primary");
    const feats = [edge];
    const bounds = computeFeatureBounds(feats);
    expect(cullRoadFeatures(feats, bounds, VIEWPORT, HIGH_ZOOM)).toHaveLength(1);
    // One epsilon beyond the margin is dropped.
    const beyond = feature("beyond", [[1 + CULL_MARGIN + 0.01, 0.5]], "primary");
    const feats2 = [beyond];
    const bounds2 = computeFeatureBounds(feats2);
    expect(cullRoadFeatures(feats2, bounds2, VIEWPORT, HIGH_ZOOM)).toHaveLength(0);
  });
});
